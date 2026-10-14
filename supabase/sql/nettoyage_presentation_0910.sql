-- Nettoyage des données de la présentation du 09/10/2026, avant les
-- premiers vrais dossiers. À coller UNE FOIS dans Supabase > SQL Editor.
--
-- Supprime : les documents de démonstration (DEV-2026-000001,
-- FAC-2026-000001), leurs lignes, paiements et mouvements de stock, les
-- clients et leads créés pendant la présentation, et remet les compteurs à
-- zéro (la première facture proforma sera FP-2026-000001, la première
-- commande CMD-2026-000001, la première facture FAC-2026-000001, le premier
-- client CLI-000001). Le stock retiré par la facture de démonstration est
-- remis en place. Les comptes utilisateurs, le catalogue et les pièces ne
-- sont pas touchés.

begin;

-- 1. Stock : on rend ce que les factures de démonstration avaient retiré.
update products p
   set quantity_on_hand = p.quantity_on_hand - m.total, updated_at = now()
  from (select product_id, sum(quantity) as total
          from stock_movements
         where reference_document_id is not null
         group by product_id) m
 where p.id = m.product_id;
delete from stock_movements where reference_document_id is not null;

-- 2. Documents et tout ce qui en dépend.
delete from payments;
delete from document_sendings;
update notifications set related_document_id = null where related_document_id is not null;
delete from document_items;
update documents set parent_document_id = null;
delete from documents;

-- 3. Contacts de démonstration.
delete from prospect_activities;
delete from prospect_appointments;
delete from prospects;
delete from client_attachments;
delete from clients;

-- 4. Compteurs.
delete from document_number_counters;
delete from client_number_counters;

-- 5. Notifications de test.
delete from notifications;

commit;

-- Vérification : tout doit être à 0, sauf les véhicules (5) et les pièces (348).
select
  (select count(*) from documents) as documents,
  (select count(*) from clients) as clients,
  (select count(*) from prospects) as leads,
  (select count(*) from payments) as paiements,
  (select count(*) from document_number_counters) as compteurs,
  (select count(*) from products) as vehicules,
  (select count(*) from parts) as pieces,
  (select sum(quantity_on_hand) from products) as stock_vehicules;
