-- Permet de supprimer un devis/facture erroné.
--
-- 1) RLS : aucune policy DELETE n'existait sur `documents` ni sur
--    `document_sendings` (RLS "deny by default" bloquait donc toute
--    suppression, même pour un super_admin). On reprend exactement le même
--    périmètre que les policies UPDATE/INSERT déjà en place.
-- 2) Contraintes de clé étrangère : `documents.parent_document_id` (lien
--    devis -> facture générée) et `notifications.related_document_id`
--    n'avaient pas de "on delete", donc Postgres aurait bloqué la
--    suppression d'un document encore référencé ailleurs. On les passe en
--    "on delete set null" : on garde la facture/notification, on perd juste
--    le lien vers un document qui n'existe plus.
-- 3) `payments.document_id` reste volontairement SANS "on delete cascade" :
--    on ne veut jamais supprimer silencieusement un historique de paiement.
--    C'est pourquoi `deleteDocument()` (lib/documents/actions.ts) vérifie et
--    refuse la suppression d'un document ayant déjà des paiements enregistrés.

alter table documents drop constraint if exists documents_parent_document_id_fkey;
alter table documents
  add constraint documents_parent_document_id_fkey
  foreign key (parent_document_id) references documents(id) on delete set null;

alter table notifications drop constraint if exists notifications_related_document_id_fkey;
alter table notifications
  add constraint notifications_related_document_id_fkey
  foreign key (related_document_id) references documents(id) on delete set null;

create policy documents_delete on documents for delete using (
  organization_id = auth_org_id() and (
    auth_role() in ('super_admin', 'administrateur')
    or commercial_id = auth.uid()
  )
);

create policy document_sendings_delete on document_sendings for delete using (
  exists (
    select 1 from documents d
    where d.id = document_sendings.document_id
      and d.organization_id = auth_org_id()
      and (auth_role() in ('super_admin','administrateur') or d.commercial_id = auth.uid())
  )
);
