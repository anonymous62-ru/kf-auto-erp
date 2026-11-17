-- 0047 : SAV, fiche de réception et de restitution d'un véhicule.
--
-- Une fiche par ordre de réparation et par sens (réception à l'entrée,
-- restitution à la sortie). Le client signe sur la tablette ou le
-- téléphone ; une fois signée, la fiche est figée (seule la direction peut
-- encore la corriger). La restitution n'est possible qu'après une
-- réception signée, pour pouvoir comparer l'état d'entrée et de sortie.
--
-- Niveau de carburant : stocké en HUITIÈMES de réservoir (0 = vide,
-- 8 = plein), comme les graduations d'une jauge de tableau de bord. C'est
-- plus fidèle à ce que le réceptionniste lit réellement qu'un pourcentage
-- (personne ne lit "37 %") ; l'écran affiche Vide, 1/4, 1/2, 3/4, Plein et
-- les crans intermédiaires (1/8, 3/8, 5/8, 7/8).
--
-- Photos et signature : bucket PRIVÉ "sav-inspections", chemin
-- <organization_id>/<repair_order_id>/<fichier>. Les colonnes photos et
-- client_signature_url contiennent le CHEMIN dans le bucket (pas une URL
-- publique) ; l'application génère des liens signés pour l'affichage.

-- ---------- Table ----------
create table if not exists public.vehicle_inspections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  repair_order_id uuid not null references public.repair_orders(id) on delete cascade,
  kind text not null check (kind in ('reception', 'restitution')),
  receptionist_name text,
  inspected_at timestamptz not null default now(),
  mileage integer check (mileage is null or (mileage >= 0 and mileage <= 5000000)),
  fuel_level smallint check (fuel_level is null or (fuel_level between 0 and 8)),
  checklist jsonb not null default '{}'::jsonb check (jsonb_typeof(checklist) = 'object'),
  observations text,
  photos text[] not null default '{}'::text[],
  client_signature_url text,
  client_signed_at timestamptz,
  client_signer_name text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_inspections_one_per_kind unique (repair_order_id, kind),
  constraint vehicle_inspections_photos_max check (coalesce(array_length(photos, 1), 0) <= 20)
);

create index if not exists vehicle_inspections_org_idx on public.vehicle_inspections (organization_id);

comment on table public.vehicle_inspections is
  'Fiches de réception et de restitution SAV (une de chaque par ordre de réparation).';
comment on column public.vehicle_inspections.fuel_level is
  'Niveau de carburant en huitièmes de réservoir : 0 = vide, 4 = moitié, 8 = plein.';
comment on column public.vehicle_inspections.checklist is
  '{ "body_ok": bool, "body_damages": [{zone, type, comment}], "warning_lights": [clé], "warning_lights_other": text, "accessories": [clé], "accessories_other": text }';
comment on column public.vehicle_inspections.photos is
  'Chemins dans le bucket privé sav-inspections (<org>/<ordre>/<fichier>).';
comment on column public.vehicle_inspections.client_signature_url is
  'Chemin de l''image de signature dans le bucket privé sav-inspections.';

revoke all on public.vehicle_inspections from anon;
grant select, insert, update, delete on public.vehicle_inspections to authenticated;

alter table public.vehicle_inspections enable row level security;

-- ---------- Rôles ----------
-- Écriture : mêmes rôles que la création d'un ordre de réparation
-- (repair_orders_insert) : direction, réception SAV, chef d'atelier,
-- responsable showroom. Lecture : toute l'organisation, comme
-- repair_orders_select.
create or replace function public.can_write_vehicle_inspection()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(auth_role()::text in (
    'super_admin', 'administrateur', 'manager', 'receptionniste_sav', 'chef_atelier', 'responsable_showroom'
  ), false);
$$;

create or replace function public.sav_is_direction()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(auth_role()::text in ('super_admin', 'administrateur', 'manager'), false);
$$;

revoke all on function public.can_write_vehicle_inspection() from public, anon;
grant execute on function public.can_write_vehicle_inspection() to authenticated;
revoke all on function public.sav_is_direction() from public, anon;
grant execute on function public.sav_is_direction() to authenticated;

-- ---------- Policies ----------
create policy vehicle_inspections_select on public.vehicle_inspections
  for select using (organization_id = auth_org_id());

create policy vehicle_inspections_insert on public.vehicle_inspections
  for insert with check (organization_id = auth_org_id() and can_write_vehicle_inspection());

create policy vehicle_inspections_update on public.vehicle_inspections
  for update using (organization_id = auth_org_id() and can_write_vehicle_inspection())
  with check (organization_id = auth_org_id() and can_write_vehicle_inspection());

create policy vehicle_inspections_delete on public.vehicle_inspections
  for delete using (organization_id = auth_org_id() and sav_is_direction());

create policy mfa_required on public.vehicle_inspections
  as restrictive for all to authenticated
  using ((select mfa_satisfied())) with check ((select mfa_satisfied()));

-- ---------- Garde : cohérence, restitution après réception, fiche figée ----------
create or replace function public.vehicle_inspections_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order_org uuid;
  v_prefix text;
  v_reception record;
  v_path text;
begin
  if tg_op = 'DELETE' then
    if old.client_signed_at is not null and not sav_is_direction() and auth.uid() is not null then
      raise exception 'Fiche signée par le client : suppression réservée à la direction.';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.repair_order_id <> old.repair_order_id or new.kind <> old.kind
       or new.organization_id <> old.organization_id then
      raise exception 'L''ordre de réparation et le type de fiche ne peuvent pas être changés.';
    end if;
    if old.client_signed_at is not null and auth.uid() is not null and not sav_is_direction() then
      raise exception 'Fiche signée par le client : elle ne peut plus être modifiée.';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  select organization_id into v_order_org from repair_orders where id = new.repair_order_id;
  if v_order_org is null then
    raise exception 'Ordre de réparation introuvable.';
  end if;
  if tg_op = 'INSERT' then
    new.organization_id := v_order_org;
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  elsif new.organization_id <> v_order_org then
    raise exception 'Organisation incohérente.';
  end if;

  -- Restitution : uniquement après une réception signée par le client.
  if new.kind = 'restitution' then
    select mileage, client_signed_at into v_reception
      from vehicle_inspections
     where repair_order_id = new.repair_order_id and kind = 'reception';
    if not found then
      raise exception 'Faites d''abord la fiche de réception du véhicule.';
    end if;
    if v_reception.client_signed_at is null then
      raise exception 'La fiche de réception doit être signée par le client avant la restitution.';
    end if;
    if new.mileage is not null and v_reception.mileage is not null and new.mileage < v_reception.mileage then
      raise exception 'Kilométrage de sortie (%) inférieur au kilométrage d''entrée (%).', new.mileage, v_reception.mileage;
    end if;
  end if;

  -- Fichiers : uniquement dans le dossier de cet ordre de réparation.
  v_prefix := new.organization_id::text || '/' || new.repair_order_id::text || '/';
  foreach v_path in array coalesce(new.photos, '{}'::text[]) loop
    if v_path is null or left(v_path, length(v_prefix)) <> v_prefix or position('..' in v_path) > 0 then
      raise exception 'Chemin de photo invalide.';
    end if;
  end loop;

  -- Signature client : date posée par le serveur, nom du signataire exigé.
  if new.client_signature_url is not null then
    if left(new.client_signature_url, length(v_prefix)) <> v_prefix or position('..' in new.client_signature_url) > 0 then
      raise exception 'Chemin de signature invalide.';
    end if;
    if coalesce(btrim(new.client_signer_name), '') = '' then
      raise exception 'Indiquez le nom de la personne qui signe.';
    end if;
    if tg_op = 'INSERT' or old.client_signature_url is distinct from new.client_signature_url then
      new.client_signed_at := now();
    end if;
  else
    new.client_signed_at := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger vehicle_inspections_guard
  before insert or update or delete on public.vehicle_inspections
  for each row execute function public.vehicle_inspections_guard();

-- ---------- Kilométrage d'entrée de l'ordre de réparation ----------
-- À la réception, si l'OR n'a pas encore de kilométrage d'entrée, on le
-- reprend de la fiche (on n'écrase jamais une valeur déjà saisie).
create or replace function public.vehicle_inspections_sync_mileage()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.kind = 'reception' and new.mileage is not null then
    update repair_orders
       set vehicle_mileage_in = new.mileage
     where id = new.repair_order_id
       and vehicle_mileage_in is null;
  end if;
  return null;
end;
$$;

create trigger vehicle_inspections_sync_mileage
  after insert or update of mileage on public.vehicle_inspections
  for each row execute function public.vehicle_inspections_sync_mileage();

revoke all on function public.vehicle_inspections_guard() from public, anon, authenticated;
revoke all on function public.vehicle_inspections_sync_mileage() from public, anon, authenticated;

-- ---------- Stockage privé des photos et signatures ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sav-inspections', 'sav-inspections', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Le dossier <org>/<ordre>/ doit correspondre à un ordre de réparation de
-- l'organisation de l'utilisateur.
create or replace function public.sav_inspection_folder_ok(p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'storage'
as $$
  select (storage.foldername(p_name))[1] = auth_org_id()::text
     and exists (
       select 1 from repair_orders r
        where r.id::text = (storage.foldername(p_name))[2]
          and r.organization_id = auth_org_id()
     );
$$;

-- Un fichier déjà rattaché à une fiche signée ne peut plus être supprimé.
create or replace function public.sav_inspection_file_locked(p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from vehicle_inspections vi
     where vi.client_signed_at is not null
       and (p_name = any(vi.photos) or vi.client_signature_url = p_name)
  );
$$;

revoke all on function public.sav_inspection_folder_ok(text) from public, anon;
grant execute on function public.sav_inspection_folder_ok(text) to authenticated;
revoke all on function public.sav_inspection_file_locked(text) from public, anon;
grant execute on function public.sav_inspection_file_locked(text) to authenticated;

create policy sav_inspections_select on storage.objects
  for select to authenticated
  using (bucket_id = 'sav-inspections' and public.sav_inspection_folder_ok(name));

create policy sav_inspections_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sav-inspections'
    and public.can_write_vehicle_inspection()
    and public.sav_inspection_folder_ok(name)
  );

create policy sav_inspections_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'sav-inspections'
    and public.can_write_vehicle_inspection()
    and public.sav_inspection_folder_ok(name)
    and not public.sav_inspection_file_locked(name)
  );

-- Pas de policy UPDATE : un fichier envoyé n'est jamais remplacé (upsert refusé).

create policy sav_inspections_mfa on storage.objects
  as restrictive for all to authenticated
  using (bucket_id <> 'sav-inspections' or (select public.mfa_satisfied()))
  with check (bucket_id <> 'sav-inspections' or (select public.mfa_satisfied()));
