-- Stockage des fichiers (appliqué le 04/10 au soir).
-- - Signatures : dossier privé. Avant, il était public, et même lisible sans
--   compte via l'API ; tout employé pouvait aussi écraser n'importe quelle
--   signature (policy update ouverte). L'application affiche désormais les
--   signatures avec un lien temporaire généré côté serveur
--   (lib/storage/signed-url.ts) et le PDF les lit avec la clé serveur.
-- - Logo/branding : écriture réservée aux administrateurs.
-- - Photos de véhicules : suppression réservée à la direction et au
--   responsable showroom.
alter policy signatures_select on storage.objects using (bucket_id = 'document-signatures' and auth.role() = 'authenticated');
alter policy signatures_update on storage.objects using (false);
alter policy branding_write on storage.objects
  using (bucket_id = 'org-branding' and auth_role()::text in ('super_admin', 'administrateur'))
  with check (bucket_id = 'org-branding' and auth_role()::text in ('super_admin', 'administrateur'));
alter policy vehicle_photos_org_delete on storage.objects
  using (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = auth_org_id()::text
         and auth_role()::text in ('super_admin', 'administrateur', 'manager', 'responsable_showroom'));
update storage.buckets set public = false where id = 'document-signatures';
