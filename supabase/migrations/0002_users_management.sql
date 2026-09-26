-- Permet à un super_admin/administrateur de modifier le rôle ou le statut
-- (actif/inactif) d'un autre utilisateur de sa propre organisation.
-- La création de compte, elle, passe par la clé service_role (bypass RLS),
-- donc aucune policy INSERT n'est nécessaire ici.
create policy profiles_update_admin on profiles for update using (
  organization_id = auth_org_id()
  and auth_role() in ('super_admin', 'administrateur')
);
