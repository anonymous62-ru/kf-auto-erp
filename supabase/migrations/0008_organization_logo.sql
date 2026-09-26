-- Jusqu'ici, `organizations.logo_url` existait dans le schéma mais rien dans
-- l'application ne permettait de le renseigner : aucun bucket de stockage,
-- aucune page de réglages. Résultat : le logo ne s'affichait jamais sur les
-- documents (PDF/DOCX) ni dans l'interface, pas parce que le code de rendu
-- était en défaut, mais parce que la valeur en base était toujours nulle.
--
-- Ce fichier crée :
--  1. Un bucket de stockage public "logos" (le logo doit être visible sans
--     authentification : page de connexion, documents envoyés par email...).
--  2. Des policies de stockage : upload/suppression réservés aux
--     administrateurs de l'organisation, dans un dossier "<organization_id>/".
--  3. Une fonction publique (security definer) qui expose uniquement le nom
--     et le logo de l'organisation, pour que la page de connexion (avant
--     authentification) puisse afficher le vrai logo au lieu d'un badge
--     texte "KF" — sans exposer le reste des données de l'organisation
--     (banque, RCCM, adresse...) à un visiteur non connecté.

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
