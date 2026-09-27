-- Correctif : "Organisation introuvable." sur /settings/organisation.
--
-- getMyOrganization() (lib/organization/actions.ts) ne filtre PAS par id
-- explicitement : il compte entièrement sur la policy RLS "organizations_select"
-- (id = auth_org_id()) pour ne renvoyer que la propre organisation de
-- l'utilisateur. Si cette policy n'existe pas (ou plus) sur la table
-- "organizations", Postgres applique le comportement par défaut de la RLS :
-- refuser silencieusement toute lecture -> 0 ligne renvoyée, SANS erreur.
-- C'est exactement ce qui produit "Organisation introuvable." alors que rien
-- ne plante côté code.
--
-- Ce script est idempotent (DROP POLICY IF EXISTS avant chaque CREATE), donc
-- sans danger à exécuter même si les policies existent déjà.

alter table organizations enable row level security;

drop policy if exists organizations_select on organizations;
create policy organizations_select on organizations for select using (
  id = auth_org_id()
);

drop policy if exists organizations_update on organizations;
create policy organizations_update on organizations for update using (
  id = auth_org_id() and auth_role() in ('super_admin', 'administrateur')
);

-- Vérification : doit renvoyer exactement 1 ligne (votre organisation).
-- Si ça renvoie 0 ligne, c'est que profiles.organization_id ne correspond à
-- aucune ligne de "organizations" pour votre utilisateur -- copiez le
-- résultat de cette requête et je regarde plus précisément.
select p.id as profile_id, p.organization_id, o.id as organization_id_reel, o.name
from profiles p
left join organizations o on o.id = p.organization_id
where p.id = auth.uid();
