-- =============================================================================
-- 0046 : Fiche client, pièces justificatives et banque (réunion du 16/11/2026)
--
-- Pièces attendues :
--   particulier : carte d'identité (cni), certificat de nationalité
--                 (nationalite), acte de naissance (acte_naissance)
--   entreprise  : carte d'opérateur économique (coe) OU carte unique de
--                 création d'entreprise (carte_unique_creation)
-- Une pièce manquante ne bloque jamais la vente : l'application affiche
-- seulement un avertissement (fiche client, liste, vérification ADV).
--
-- Choix : nouvelle table client_documents plutôt que client_attachments.
--   client_attachments (0001) est vide, n'est utilisée par aucun code et
--   n'a plus que la policy restrictive mfa_required (aucune policy
--   permissive : personne ne peut la lire). Elle stocke une URL de fichier
--   (modèle bucket public), sans organisation, sans type de pièce, sans
--   type MIME ni taille. On la laisse en place (aucune suppression) et on
--   crée une table dédiée, typée, alignée sur un bucket privé.
--
-- Droits :
--   lecture     : qui peut lire le client (mêmes rôles que clients_select)
--                 + responsable_commercial (N+1 des commerciaux)
--   ajout       : qui peut modifier le client (rôles de clients_update ou
--                 commercial attitré), dont admin_ventes et direction
--   suppression : direction (super_admin, administrateur, manager),
--                 admin_ventes, ou l'auteur de l'envoi dans les 24 h.
--                 Passé ce délai, un commercial ne peut plus retirer une
--                 pièce que l'ADV a pu contrôler : il en ajoute une nouvelle.
--   modification: aucune (une pièce se remplace en ajoutant une nouvelle).
-- =============================================================================

-- 1. Le responsable commercial lit les clients des commerciaux
alter policy clients_select on public.clients using (
  (organization_id = auth_org_id())
  and (
    (auth_role())::text = any (array['super_admin', 'administrateur', 'manager', 'comptable',
      'receptionniste_sav', 'chef_atelier', 'admin_ventes', 'responsable_commercial'])
    or (assigned_to = auth.uid())
  )
);

-- 2. Fonctions de droits (SECURITY DEFINER : lisent clients sans dépendre
--    de la RLS de l'appelant, utilisables dans les policies storage)
create or replace function public.can_read_client(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.clients c
     where c.id = p_client
       and c.organization_id = auth_org_id()
       and (coalesce(auth_role()::text, '') in ('super_admin', 'administrateur', 'manager', 'comptable',
              'receptionniste_sav', 'chef_atelier', 'admin_ventes', 'responsable_commercial')
            or c.assigned_to = auth.uid())
  );
$$;

create or replace function public.can_write_client_documents(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.clients c
     where c.id = p_client
       and c.organization_id = auth_org_id()
       and (coalesce(auth_role()::text, '') in ('super_admin', 'administrateur', 'manager', 'comptable',
              'receptionniste_sav', 'admin_ventes')
            or c.assigned_to = auth.uid())
  );
$$;

-- 3. Table des pièces
create table if not exists public.client_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('cni', 'nationalite', 'acte_naissance', 'coe', 'carte_unique_creation', 'autre')),
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint client_documents_path_check
    check (storage_path like organization_id::text || '/' || client_id::text || '/%')
);
create index if not exists client_documents_client_idx on public.client_documents (client_id, kind);
alter table public.client_documents enable row level security;

create or replace function public.can_delete_client_document(p_uploaded_by uuid, p_created_at timestamptz, p_client uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_write_client_documents(p_client)
     and (coalesce(auth_role()::text, '') in ('super_admin', 'administrateur', 'manager', 'admin_ventes')
          or (p_uploaded_by = auth.uid() and p_created_at > now() - interval '24 hours'));
$$;

create policy client_documents_select on public.client_documents for select to authenticated
  using (organization_id = auth_org_id() and public.can_read_client(client_id));
create policy client_documents_insert on public.client_documents for insert to authenticated
  with check (
    organization_id = auth_org_id()
    and uploaded_by = auth.uid()
    and public.can_write_client_documents(client_id)
  );
create policy client_documents_delete on public.client_documents for delete to authenticated
  using (organization_id = auth_org_id() and public.can_delete_client_document(uploaded_by, created_at, client_id));
create policy mfa_required on public.client_documents as restrictive for all to authenticated
  using ((select mfa_satisfied())) with check ((select mfa_satisfied()));

revoke all on public.client_documents from anon;
grant select, insert, delete on public.client_documents to authenticated;

-- 4. Bucket privé
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-documents', 'client-documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Client désigné par le chemin <organization_id>/<client_id>/<uuid>-<nom>
create or replace function public.client_document_path_client(p_name text) returns uuid
language sql immutable set search_path = public as $$
  select case when split_part(p_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 2)::uuid end;
$$;

-- Lecture d'un fichier : via la ligne client_documents (droit de lecture du
-- client). Un fichier sans ligne (envoi en cours ou échoué) n'est visible
-- que de qui peut ajouter des pièces à ce client, pour pouvoir le nettoyer.
create or replace function public.can_read_client_document_object(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select split_part(p_name, '/', 1) = auth_org_id()::text
     and case
       when exists (select 1 from public.client_documents d where d.storage_path = p_name)
         then exists (select 1 from public.client_documents d
                       where d.storage_path = p_name
                         and d.organization_id = auth_org_id()
                         and public.can_read_client(d.client_id))
       else public.can_write_client_documents(public.client_document_path_client(p_name))
     end;
$$;

create or replace function public.can_delete_client_document_object(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select split_part(p_name, '/', 1) = auth_org_id()::text
     and case
       when exists (select 1 from public.client_documents d where d.storage_path = p_name)
         then exists (select 1 from public.client_documents d
                       where d.storage_path = p_name
                         and d.organization_id = auth_org_id()
                         and public.can_delete_client_document(d.uploaded_by, d.created_at, d.client_id))
       else public.can_write_client_documents(public.client_document_path_client(p_name))
     end;
$$;

create policy client_documents_obj_select on storage.objects for select to authenticated
  using (bucket_id = 'client-documents' and public.can_read_client_document_object(name));
create policy client_documents_obj_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = auth_org_id()::text
    and public.can_write_client_documents(public.client_document_path_client(name))
  );
create policy client_documents_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'client-documents' and public.can_delete_client_document_object(name));
-- Pas de policy update : un fichier envoyé ne se remplace pas (upsert refusé).

-- 5. Journal d'export du dossier client
create or replace function public.log_client_export(p_client uuid, p_count int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Non authentifié';
  end if;
  if not public.can_read_client(p_client) then
    raise exception 'Accès refusé';
  end if;
  insert into audit_log (organization_id, user_id, table_name, record_id, action, new_data)
  values (auth_org_id(), auth.uid(), 'client_documents', p_client, 'export'::audit_action,
          jsonb_build_object('fichiers', p_count));
end;
$$;

revoke all on function public.can_read_client(uuid) from public, anon;
revoke all on function public.can_write_client_documents(uuid) from public, anon;
revoke all on function public.can_delete_client_document(uuid, timestamptz, uuid) from public, anon;
revoke all on function public.can_read_client_document_object(text) from public, anon;
revoke all on function public.can_delete_client_document_object(text) from public, anon;
revoke all on function public.log_client_export(uuid, int) from public, anon;
grant execute on function public.can_read_client(uuid) to authenticated;
grant execute on function public.can_write_client_documents(uuid) to authenticated;
grant execute on function public.can_delete_client_document(uuid, timestamptz, uuid) to authenticated;
grant execute on function public.can_read_client_document_object(text) to authenticated;
grant execute on function public.can_delete_client_document_object(text) to authenticated;
grant execute on function public.log_client_export(uuid, int) to authenticated;
