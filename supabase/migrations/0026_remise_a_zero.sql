-- ============================================================================
-- REMISE À ZÉRO AVANT LE DÉMARRAGE (04/10/2026)
-- ============================================================================
-- Efface toutes les données de test : clients, prospects, devis, proformas,
-- factures, paiements, contrats, atelier, notifications, historique de stock
-- et journal d'audit. Les compteurs repartent de 1 (FAC-2026-000001,
-- DEV-2026-000001, CV-2026-000001, OR-2026-000001...).
--
-- CONSERVÉ : les utilisateurs et leurs rôles, les réglages de l'organisation
-- (logo, coordonnées, banque), le catalogue des 5 véhicules et leurs photos,
-- les 348 pièces détachées importées.
--
-- Le stock des véhicules est remis à 0 (les quantités actuelles viennent des
-- tests) : saisir le vrai stock dès demain via "+ Ajouter au stock" sur
-- chaque véhicule.
--
-- Une copie complète des données a été faite avant, dans le schéma
-- "sauvegarde" (tables *_20261004), invisible depuis l'application.
--
-- A exécuter UNE FOIS dans Supabase > SQL Editor. Irréversible (hors copie).
-- ============================================================================

begin;

-- Atelier / SAV / garanties
delete from warranty_claims;
delete from repair_order_items;
delete from repair_orders;
delete from vehicle_warranties;
delete from workshop_appointments;
delete from parts_stock_movements;

-- Ventes
delete from payments;
delete from sale_contracts;
delete from document_sendings;
delete from document_items;
delete from notifications;
delete from documents;

-- Prospects et clients
delete from prospect_activities;
delete from prospect_appointments;
delete from prospects;
delete from client_attachments;
delete from clients;

-- Stock véhicules : historique effacé, quantités à 0, produit "test" retiré
delete from stock_movements;
delete from products where designation = 'test';
update products set quantity_on_hand = 0, updated_at = now();

-- Numérotation : tout repart de 1
delete from document_number_counters;
delete from sale_contract_counters;
delete from repair_order_counters;

-- Journal d'audit des tests (en dernier : les suppressions ci-dessus y
-- ajoutent elles-mêmes des lignes)
delete from audit_log;

commit;

-- Vérification : tout doit afficher 0 sauf vehicules (5) et pieces (348)
select
  (select count(*) from clients) as clients,
  (select count(*) from prospects) as prospects,
  (select count(*) from documents) as documents,
  (select count(*) from payments) as paiements,
  (select count(*) from sale_contracts) as contrats,
  (select count(*) from document_number_counters) as compteurs,
  (select count(*) from products) as vehicules,
  (select count(*) from parts) as pieces;
