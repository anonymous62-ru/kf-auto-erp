-- Correctif : logo absent (icône d'image cassée) malgré un organizations.logo_url
-- renseigné.
--
-- Même symptôme que la migration précédente (0014) : le bucket de stockage
-- "logos" et ses policies ont été introduits par la migration
-- 0008_organization_logo.sql, mais tout indique que cette migration (comme la
-- 0006) n'a jamais été exécutée sur cette base. Résultat : l'upload du logo
-- a pu écrire une URL dans organizations.logo_url (ou échouer silencieusement),
-- mais le bucket "logos" n'existe pas réellement (ou n'est pas public), donc
-- l'URL publique renvoie une erreur -> image cassée dans le navigateur ET
-- absente des PDF/DOCX (qui échouent aussi silencieusement à télécharger
-- l'image, cf. urlToImageBuffer qui "avale" l'erreur pour ne pas bloquer la
-- génération du document).
--
-- Idempotent : sûr à rejouer.

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do update set public = true;

drop policy if exists logos_public_read on storage.objects;
create policy logos_public_read on storage.objects for select
  using (bucket_id = 'logos');

drop policy if exists logos_admin_write on storage.objects;
create policy logos_admin_write on storage.objects for insert
  with check (
    bucket_id = 'logos'
    and auth_role() in ('super_admin', 'administrateur')
    and (storage.foldername(name))[1] = auth_org_id()::text
  );

drop policy if exists logos_admin_update on storage.objects;
create policy logos_admin_update on storage.objects for update
  using (
    bucket_id = 'logos'
    and auth_role() in ('super_admin', 'administrateur')
    and (storage.foldername(name))[1] = auth_org_id()::text
  );

drop policy if exists logos_admin_delete on storage.objects;
create policy logos_admin_delete on storage.objects for delete
  using (
    bucket_id = 'logos'
    and auth_role() in ('super_admin', 'administrateur')
    and (storage.foldername(name))[1] = auth_org_id()::text
  );

create or replace function get_organization_branding()
returns table (name text, logo_url text)
language sql
security definer
set search_path = public
as $$
  select o.name, o.logo_url
  from organizations o
  order by o.created_at
  limit 1;
$$;

grant execute on function get_organization_branding() to anon, authenticated;

-- Vérification : doit lister le bucket "logos" avec public = true.
select id, name, public from storage.buckets where id = 'logos';
