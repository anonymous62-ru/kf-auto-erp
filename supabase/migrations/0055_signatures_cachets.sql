-- 0055 : signatures enregistrées et cachets de l'entreprise (17/11/2026).
--
-- Demande : la signature du N+1 est insérée automatiquement à la validation
-- d'une proforma ; la signature du commercial et le cachet « service
-- commercial » sortent automatiquement ; le client peut signer au stylo
-- après (sa case reste vide sur le PDF).
--
-- Choix :
-- * chaque utilisateur enregistre une fois sa signature (profiles.signature_path),
--   la direction enregistre trois cachets (organizations.stamp_*_path) ;
-- * fichiers dans un bucket PRIVÉ « user-signatures », chemins
--     <org>/users/<user_id>/<fichier>.png|jpg   (signature)
--     <org>/stamps/<fichier>.png|jpg            (cachet)
--   Lecture : membres de l'organisation. Écriture : l'utilisateur pour sa
--   propre signature, la direction (super_admin, administrateur) pour les
--   autres et pour les cachets. Aucun remplacement ni suppression par l'API :
--   un nouveau fichier est créé à chaque changement, l'ancien reste lisible
--   par les documents qui l'ont figé ;
-- * la proforma FIGE (copie du chemin) la signature et le cachet au moment
--   de la soumission (commercial) et de la validation (N+1) : changer sa
--   signature plus tard ne modifie pas une proforma déjà envoyée au client.
--   Colonnes documents.commercial_signature_path, commercial_stamp_path,
--   n1_signature_path, n1_stamp_path, écrites uniquement par les fonctions
--   du circuit (garde trg_signature_snapshot_guard).
-- La signature client reste facultative (mark_proforma_accepted ne l'exige
-- pas ; documents_workflow_guard la refuse toujours avant validation).

-- ---------- Colonnes ----------
alter table public.profiles
  add column if not exists signature_path text,
  add column if not exists signature_updated_at timestamptz;

alter table public.organizations
  add column if not exists stamp_commercial_path text,
  add column if not exists stamp_sales_manager_path text,
  add column if not exists stamp_direction_path text,
  add column if not exists stamps_updated_at timestamptz;

alter table public.documents
  add column if not exists commercial_signature_path text,
  add column if not exists commercial_stamp_path text,
  add column if not exists n1_signature_path text,
  add column if not exists n1_stamp_path text;

-- ---------- Bucket privé ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-signatures', 'user-signatures', false, 1048576, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Direction habilitée à gérer cachets et signatures des autres.
create or replace function public.is_signature_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth_role()::text, '') in ('super_admin', 'administrateur');
$$;

-- Nom de fichier accepté (pas de sous-dossier, pas de « .. »).
create or replace function public.signature_file_name_ok(p_file text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_file, '') ~ '^[A-Za-z0-9_-]{1,80}\.(png|jpg)$';
$$;

create or replace function public.can_read_user_signature_object(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and auth_org_id() is not null
     and split_part(coalesce(p_name, ''), '/', 1) = auth_org_id()::text;
$$;

create or replace function public.can_write_user_signature_object(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_parts text[] := string_to_array(coalesce(p_name, ''), '/');
  v_org uuid := auth_org_id();
begin
  if auth.uid() is null or v_org is null or v_parts[1] is distinct from v_org::text then
    return false;
  end if;
  if array_length(v_parts, 1) = 4 and v_parts[2] = 'users' and signature_file_name_ok(v_parts[4]) then
    if v_parts[3] = auth.uid()::text then return true; end if;
    return is_signature_admin()
       and exists (select 1 from profiles p where p.id::text = v_parts[3] and p.organization_id = v_org);
  end if;
  if array_length(v_parts, 1) = 3 and v_parts[2] = 'stamps' and signature_file_name_ok(v_parts[3]) then
    return is_signature_admin();
  end if;
  return false;
end;
$$;

create policy user_signatures_select on storage.objects for select to authenticated
  using (bucket_id = 'user-signatures' and public.can_read_user_signature_object(name));
create policy user_signatures_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'user-signatures' and public.can_write_user_signature_object(name));
create policy user_signatures_mfa on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'user-signatures' or (select public.mfa_satisfied()))
  with check (bucket_id <> 'user-signatures' or (select public.mfa_satisfied()));

-- ---------- Contrôle des chemins enregistrés ----------
create or replace function public.signature_object_exists(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from storage.objects o where o.bucket_id = 'user-signatures' and o.name = p_path);
$$;

create or replace function public.profiles_signature_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.signature_path is not distinct from old.signature_path then
    return new;
  end if;
  if auth.uid() is not null and new.id <> auth.uid() and not is_signature_admin() then
    raise exception 'Seule la direction peut modifier la signature d''un autre utilisateur.';
  end if;
  if new.signature_path is not null then
    if split_part(new.signature_path, '/', 1) <> new.organization_id::text
       or split_part(new.signature_path, '/', 2) <> 'users'
       or split_part(new.signature_path, '/', 3) <> new.id::text
       or array_length(string_to_array(new.signature_path, '/'), 1) <> 4
       or not signature_file_name_ok(split_part(new.signature_path, '/', 4))
       or not signature_object_exists(new.signature_path) then
      raise exception 'Fichier de signature invalide.';
    end if;
  end if;
  new.signature_updated_at := now();
  return new;
end;
$$;

create trigger trg_profiles_signature_guard
  before update of signature_path on public.profiles
  for each row execute function public.profiles_signature_guard();

create or replace function public.organizations_stamp_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_path text;
begin
  if new.stamp_commercial_path is not distinct from old.stamp_commercial_path
     and new.stamp_sales_manager_path is not distinct from old.stamp_sales_manager_path
     and new.stamp_direction_path is not distinct from old.stamp_direction_path then
    return new;
  end if;
  if auth.uid() is not null and not is_signature_admin() then
    raise exception 'Seule la direction peut modifier les cachets.';
  end if;
  foreach v_path in array array[new.stamp_commercial_path, new.stamp_sales_manager_path, new.stamp_direction_path] loop
    if v_path is not null and (
         split_part(v_path, '/', 1) <> new.id::text
      or split_part(v_path, '/', 2) <> 'stamps'
      or array_length(string_to_array(v_path, '/'), 1) <> 3
      or not signature_file_name_ok(split_part(v_path, '/', 3))
      or not signature_object_exists(v_path)) then
      raise exception 'Fichier de cachet invalide.';
    end if;
  end loop;
  new.stamps_updated_at := now();
  return new;
end;
$$;

create trigger trg_organizations_stamp_guard
  before update of stamp_commercial_path, stamp_sales_manager_path, stamp_direction_path on public.organizations
  for each row execute function public.organizations_stamp_guard();

-- Les copies figées sur le document ne s'écrivent que par le circuit.
create or replace function public.documents_signature_snapshot_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.commercial_signature_path := null;
    new.commercial_stamp_path := null;
    new.n1_signature_path := null;
    new.n1_stamp_path := null;
    return new;
  end if;
  if new.commercial_signature_path is distinct from old.commercial_signature_path
     or new.commercial_stamp_path is distinct from old.commercial_stamp_path
     or new.n1_signature_path is distinct from old.n1_signature_path
     or new.n1_stamp_path is distinct from old.n1_stamp_path then
    raise exception 'Les signatures et cachets enregistrés sont insérés automatiquement par le circuit de validation.';
  end if;
  return new;
end;
$$;

create trigger trg_signature_snapshot_guard
  before insert or update on public.documents
  for each row execute function public.documents_signature_snapshot_guard();

-- ---------- Soumission : signature du commercial + cachet service commercial ----------
create or replace function public.submit_proforma(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  d documents%rowtype;
  v_sig text;
begin
  d := wf_load(p_id);
  if d.document_type::text not in ('devis', 'proforma') then raise exception 'Seule une proforma se soumet à validation.'; end if;
  if d.commercial_id <> auth.uid() and not is_proforma_validator() then
    raise exception 'Vous ne pouvez soumettre que vos propres proformas.';
  end if;
  if d.status::text in ('annule', 'refuse') then raise exception 'Cette proforma est annulée.'; end if;
  if d.workflow_status = 'en_attente_validation' then raise exception 'Cette proforma est déjà soumise à validation.'; end if;
  if coalesce(d.workflow_status, 'brouillon') not in ('brouillon', 'refusee') then
    raise exception 'Cette proforma est déjà validée.';
  end if;
  if not exists (select 1 from document_items where document_id = d.id) then
    raise exception 'Ajoutez au moins un article avant de soumettre.';
  end if;
  select signature_path into v_sig from profiles where id = d.commercial_id;
  if v_sig is null and d.commercial_signature_url is null then
    if d.commercial_id = auth.uid() then
      raise exception 'Enregistrez votre signature dans « Ma signature » (menu Compte) ou signez la proforma à la main (bouton « Faire signer ») avant de la soumettre.';
    end if;
    raise exception 'Le commercial de cette proforma n''a pas de signature enregistrée : il doit l''enregistrer dans « Ma signature » ou signer la proforma à la main.';
  end if;
  update documents
     set submitted_by = auth.uid(), submitted_at = now(),
         commercial_signature_path = v_sig,
         commercial_stamp_path = (select o.stamp_commercial_path from organizations o where o.id = d.organization_id)
   where id = d.id;
  perform wf_set(d.id, 'en_attente_validation', null, 'Soumise à validation du responsable commercial');
  perform create_action('proforma_a_valider', wf_recipients(d.organization_id, 'n1'),
    'Proforma à valider',
    format('La proforma %s attend votre validation.', d.document_number),
    '/documents/' || d.id, d.id, null, document_mail_payload(d.id));
  return 'ok';
end;
$$;

-- ---------- Validation : signature enregistrée du valideur + cachet ----------
-- p_n1_signature_url vide : la signature enregistrée du valideur est
-- insérée (validation en un clic). Sinon : signature dessinée à la main,
-- contrôlée comme avant (bucket document-signatures, dossier du document).
create or replace function public.validate_proforma(p_id uuid, p_n1_signature_url text)
returns text language plpgsql security definer set search_path = public as $$
declare
  d documents%rowtype;
  v_url text := nullif(btrim(coalesce(p_n1_signature_url, '')), '');
  v_sig text;
  v_stamp text;
  v_role text;
  o organizations%rowtype;
begin
  d := wf_load(p_id);
  if d.document_type::text not in ('devis', 'proforma') then raise exception 'Seule une proforma se valide ici.'; end if;
  if not is_proforma_validator() then
    raise exception 'Les commerciaux ne peuvent pas valider une proforma.';
  end if;
  if d.commercial_id = auth.uid() then
    raise exception 'Vous ne pouvez pas valider votre propre proforma : elle doit être validée par un autre responsable.';
  end if;
  if d.workflow_status is distinct from 'en_attente_validation' then
    raise exception 'Cette proforma n''est plus en attente de validation.';
  end if;
  if v_url is not null then
    if position('/document-signatures/' in v_url) = 0 or position(d.id::text in v_url) = 0 then
      raise exception 'Signez la proforma avant de la valider.';
    end if;
  else
    select signature_path into v_sig from profiles where id = auth.uid();
    if v_sig is null then
      raise exception 'Enregistrez votre signature dans « Ma signature » (menu Compte) pour valider en un clic, ou signez à la main.';
    end if;
  end if;

  select role::text into v_role from profiles where id = auth.uid();
  select * into o from organizations where id = d.organization_id;
  v_stamp := case
    when v_role = 'responsable_commercial' then coalesce(o.stamp_sales_manager_path, o.stamp_commercial_path)
    else o.stamp_direction_path
  end;

  update documents
     set validated_by = auth.uid(), validated_at = now(),
         n1_signature_url = v_url, n1_signature_path = v_sig, n1_stamp_path = v_stamp,
         n1_signed_by = auth.uid(), n1_signed_at = now()
   where id = d.id;
  perform wf_set(d.id, 'validee', null, 'Validée et signée par le responsable commercial');
  perform resolve_actions(d.id, array['proforma_a_valider']);
  perform push_notification(d.commercial_id, 'proforma_validee', 'Proforma validée',
    format('Votre proforma %s est validée : vous pouvez l''envoyer au client.', d.document_number),
    '/documents/' || d.id, d.id, false, 'info', document_mail_payload(d.id));
  return 'ok';
end;
$$;

-- ---------- Droits ----------
revoke all on function public.is_signature_admin() from public, anon;
revoke all on function public.signature_file_name_ok(text) from public, anon, authenticated;
revoke all on function public.can_read_user_signature_object(text) from public, anon;
revoke all on function public.can_write_user_signature_object(text) from public, anon;
revoke all on function public.signature_object_exists(text) from public, anon, authenticated;
revoke all on function public.profiles_signature_guard() from public, anon, authenticated;
revoke all on function public.organizations_stamp_guard() from public, anon, authenticated;
revoke all on function public.documents_signature_snapshot_guard() from public, anon, authenticated;
revoke all on function public.submit_proforma(uuid) from public, anon;
revoke all on function public.validate_proforma(uuid, text) from public, anon;
grant execute on function public.is_signature_admin() to authenticated;
grant execute on function public.can_read_user_signature_object(text) to authenticated;
grant execute on function public.can_write_user_signature_object(text) to authenticated;
grant execute on function public.submit_proforma(uuid) to authenticated;
grant execute on function public.validate_proforma(uuid, text) to authenticated;
