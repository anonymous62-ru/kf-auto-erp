-- Détail des permissions caissière / secrétaire / responsable showroom,
-- précisé par le DG dans son message vocal du 04/10 :
--
-- - Caissière (rôle `comptable`) : "vue totale sur la facture... elle doit
--   avoir la possibilité de créer un dossier client et de valider en même
--   temps [le paiement]". Déjà couvert par les policies existantes
--   (clients_select/documents_select/payments_select/payments_write
--   incluent déjà 'comptable', et clients_insert est ouvert à toute
--   l'organisation) : AUCUN changement nécessaire pour elle.
--
-- - Secrétaire (rôle `receptionniste_sav`, en charge de l'accueil/standard) :
--   "doit avoir accès à tout ça [comme la caissière], sauf qu'elle ne peut
--   pas valider le paiement. [...] Mais pour le moment, donnons au
--   secrétaire aussi le droit de valider le paiement. Après, on va le
--   retirer ce droit-là." On lui donne donc la même visibilité large que la
--   caissière sur clients/documents, PLUS, à titre TEMPORAIRE et explicite,
--   le droit de valider les paiements (payments_write). Ce droit temporaire
--   est isolé dans sa propre policy (payments_write_temp_secretaire) pour
--   pouvoir être retiré d'un coup avec un simple `drop policy`, sans toucher
--   au reste.
--
-- - Responsable showroom : garde zéro visibilité sur les dossiers des
--   commerciaux (clients_select/documents_select ne l'incluent toujours
--   PAS, cf. migration 0017) mais doit pouvoir créer un compte client et un
--   proforma pour un client qui se présente directement au showroom. C'est
--   déjà permis par clients_insert (ouvert à toute l'organisation) et par
--   documents_insert (ouvert à quiconque se déclare commercial_id = soi-même
--   sur le document qu'il crée) : AUCUN changement de policy nécessaire ici
--   non plus - seule l'interface (côté app, pas RLS) doit lui permettre de
--   créer un proforma. Elle ne verra ensuite QUE les documents qu'elle a
--   elle-même créés (commercial_id = son uid), jamais ceux des commerciaux.

drop policy if exists clients_select on clients;
create policy clients_select on clients for select using (
  organization_id = auth_org_id() and (
    auth_role()::text in ('super_admin','administrateur','manager','comptable','receptionniste_sav')
    or assigned_to = auth.uid()
  )
);

drop policy if exists documents_select on documents;
create policy documents_select on documents for select using (
  organization_id = auth_org_id() and (
    auth_role()::text in ('super_admin','administrateur','manager','comptable','receptionniste_sav')
    or commercial_id = auth.uid()
  )
);

drop policy if exists payments_select on payments;
create policy payments_select on payments for select using (
  organization_id = auth_org_id() and (
    auth_role()::text in ('super_admin','administrateur','comptable','manager','receptionniste_sav')
    or exists (select 1 from documents d where d.id = payments.document_id and d.commercial_id = auth.uid())
  )
);

-- Droit TEMPORAIRE (demande explicite du DG, 04/10) : la secrétaire peut
-- valider un paiement en attendant que le circuit "signe à la caissière"
-- soit mis en place. À RETIRER PLUS TARD avec :
--   drop policy payments_write_temp_secretaire on payments;
-- (le droit permanent de la caissière/admin, lui, reste inchangé dans
-- payments_write, créée en 0009.)
drop policy if exists payments_write_temp_secretaire on payments;
create policy payments_write_temp_secretaire on payments for insert with check (
  organization_id = auth_org_id() and auth_role()::text = 'receptionniste_sav'
);
