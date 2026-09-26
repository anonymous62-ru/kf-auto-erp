-- Intègre au catalogue les modèles dont les vraies fiches proforma ont été
-- fournies (Tiggo 2 Pro, Tiggo 4, Tiggo 7, Pick-up Himla AT 4x4), avec leurs
-- caractéristiques complètes reprises telles quelles dans le champ
-- "description" (sections en MAJUSCULES + puces "-", pour que le PDF/DOCX
-- les affiche en gras automatiquement — voir lib/documents/format-lines.ts).
-- Le Tiggo 9 est ajouté sur le même modèle, à partir de sa fiche technique
-- officielle (pas de PDF proforma fourni pour lui : le prix de vente est
-- laissé à 0, à corriger dans la fiche produit une fois connu).
--
-- Ces véhicules n'ont pas de TVA sur les proformas fournies (TVA : N/A) : le
-- taux de taxe est donc mis à 0, contrairement au 18% par défaut du reste du
-- catalogue.
--
-- Suppose une seule organisation existante (KF Auto SARL) ; upsert par
-- (organization_id, sku), donc rejouer cette migration met juste à jour les
-- mêmes fiches au lieu de les dupliquer.

insert into products (organization_id, sku, designation, brand, model, description, sale_price, tax_rate, is_active)
select
  o.id,
  v.sku,
  v.designation,
  v.brand,
  v.model,
  v.description,
  v.sale_price,
  0,
  true
from organizations o
cross join (
  values
    (
      'CHERY-TIGGO-2-PRO',
      'CHERY TIGGO 2 PRO',
      'Chery',
      'Tiggo 2 Pro',
      $$CARACTERISTIQUES TECHNIQUES
- Type de moteur : Essence, 4 cylindres en ligne, Cylindrée : 1,5 L (1 498 cm³), Puissance maximale : 109 ch à 113 ch, Couple maximal : 135 Nm à 140 Nm
- Vitesse max : 160 à 170 km/h
- Consommation moy : 6 L/100km
TRANSMISSION
- Boîte de vitesses : manuelle 5 rapports, Type de traction : Traction avant ou 2 roues motrices
DIMENSIONS
- Longueur : 4 200 mm
- Largeur : 1 760 mm
- Hauteur : 1 570 mm
- Empattement : 2 555 mm
- Garde au sol : 186 mm
ÉQUIPEMENTS DE SECURITE
- Airbags : 4
- Systèmes d'assistance : ABS
- Contrôle de stabilité
- Caméra de recul et assistance au stationnement
ÉQUIPEMENTS INTERIEURS
- Sièges : 5 places
- Écran 9 pouces
- Climatisation
- Système audio : 8 haut-parleurs
- Apple CarPlay / Android Auto$$,
      8000000
    ),
    (
      'CHERY-TIGGO-4',
      'CHERY TIGGO 4',
      'Chery',
      'Tiggo 4',
      $$CARACTERISTIQUES TECHNIQUES
- Type de moteur : Essence, 4 cylindres en ligne, Cylindrée : 1,5 L (1 500 cm³)
- Consommation : 6,7 L/100 km
- Puissance maximale : 201 à 204 ch, Couple maximal : 210 Nm à 290 Nm
TRANSMISSION
- Boîte de vitesses : Automatique à double embrayage (DCT) 6 ou 7 rapports, Type de traction : Traction avant
DIMENSIONS
- Longueur : 4 318 mm
- Largeur : 1 831 mm
- Hauteur : 1 662 mm
- Empattement : 2 610 mm
ÉQUIPEMENTS DE SECURITE
- Airbags : 6
- Systèmes d'assistance : ABS, EBD, EBA, ESP
- Caméra de recul : Oui
- Détection d'angle mort : Oui
ÉQUIPEMENTS INTERIEURS
- Sièges : 5 places en simili cuir
- Éclairage d'ambiance : Oui
- Climatisation : Automatique, bi-zone
- Système audio : 8 haut-parleurs$$,
      11000000
    ),
    (
      'CHERY-TIGGO-7',
      'CHERY TIGGO 7',
      'Chery',
      'Tiggo 7',
      $$CARACTERISTIQUES TECHNIQUES
- Type de moteur : Essence 1.5 T, 4 cylindres en ligne, Cylindrée : 1 498 cm³, Puissance maximale : 147 ch à 155 ch, Couple maximal : 210 Nm à 230 Nm
- Consommation moy : 7 L/100 km
TRANSMISSION
- Boîte de vitesses : Automatique à double embrayage (DCT) 6 ou 7 rapports, Type de traction : Traction avant (4x2)
DIMENSIONS
- Longueur : 4 500 mm
- Largeur : 1 842 mm
- Hauteur : 1 705 mm
- Empattement : 2 670 mm
ÉQUIPEMENTS DE SECURITE
- Airbags : 6
- Systèmes d'assistance : ABS, EBD, EBA, ESP
- Caméra de recul : Oui
- Détection d'angle mort : Oui
ÉQUIPEMENTS INTERIEURS
- Sièges : 5 places
- Éclairage d'ambiance : Oui
- Climatisation : Automatique, bi-zone
- Système audio : 8 haut-parleurs
- Chargeur sans fil$$,
      14000000
    ),
    (
      'CHERY-TIGGO-9',
      'CHERY TIGGO 9',
      'Chery',
      'Tiggo 9',
      $$CARACTERISTIQUES TECHNIQUES
- Type de moteur : Essence 2.0 T, 4 cylindres en ligne turbo, Puissance maximale : 261 ch
- Consommation moy : 7,5 L/100 km
TRANSMISSION
- Boîte de vitesses : Automatique à double embrayage (DCT) 7 rapports, Type de traction : Traction avant (FWD) ou intégrale (AWD)
DIMENSIONS
- Longueur : 4 810 mm
- Largeur : 1 925 mm
- Hauteur : 1 710 mm
- Empattement : 2 820 mm
ÉQUIPEMENTS DE SECURITE
- Airbags : 6
- Systèmes d'assistance : ABS, EBD, EBA, ESP
- Caméra de recul : Oui
- Détection d'angle mort : Oui
ÉQUIPEMENTS INTERIEURS
- Sièges : 7 places
- Éclairage d'ambiance : Oui
- Climatisation : Automatique, bi-zone
- Système audio : 8 haut-parleurs$$,
      0
    ),
    (
      'PICKUP-HIMLA-AT-4X4',
      'PICK-UP HIMLA AT 4X4',
      null,
      'Himla AT 4x4',
      $$CARACTERISTIQUES TECHNIQUES
- Type de moteur : Diesel, 4 cylindres en ligne turbo
- Cylindrée : 2 298 cm³ (2,3 L)
- Consommation : 9,0 L/100 km
- Puissance maximale : 163 ch (120 kW à 3 500 tr/min)
- Couple maximal : 420 Nm (1 500-2 500 tr/min)
TRANSMISSION
- Automatique, 6 rapports (AT), Type de traction : 4 roues motrices (4x4)
DIMENSIONS
- Longueur : 5 330 mm
- Largeur : 1 920 mm
- Hauteur : 1 890 mm
- Empattement : 3 230 mm
ÉQUIPEMENTS DE SECURITE
- Airbags : Frontaux, latéraux, rideaux + genoux conducteur
- Systèmes d'assistance : ABS, EBD, EBA, ESP
- Caméra de recul : Oui
- Détection d'angle mort : Oui
ÉQUIPEMENTS INTERIEURS
- Sièges : 5 places en simili cuir
- Éclairage d'ambiance : Oui
- Climatisation : Automatique, bi-zone
- Système audio : 8 haut-parleurs$$,
      18000000
    )
) as v(sku, designation, brand, model, description, sale_price)
on conflict (organization_id, sku) do update set
  designation = excluded.designation,
  brand = excluded.brand,
  model = excluded.model,
  description = excluded.description,
  sale_price = excluded.sale_price,
  tax_rate = excluded.tax_rate,
  is_active = true,
  updated_at = now();
