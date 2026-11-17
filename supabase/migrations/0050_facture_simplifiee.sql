-- 0050 : facture simplifiée (direction, 11/2026).
-- La facture n'imprime plus la fiche technique complète d'un véhicule mais
-- quelques caractéristiques courtes (moteur, boîte, sécurité, places), sans
-- litres ni dimensions. Ces lignes sont saisies sur la fiche produit
-- (products.short_specs) ; si elles sont vides, le générateur PDF les extrait
-- automatiquement de la description (lib/products/short-specs.ts).
-- La proforma et le bon de commande gardent la fiche détaillée.

alter table public.products
  add column if not exists short_specs text;

comment on column public.products.short_specs is
  'Caractéristiques courtes imprimées sur la facture (4 à 6 lignes : moteur, boîte, sécurité, places). Jamais de litres ni de dimensions.';

-- Pré-remplissage des véhicules existants (extraction à partir de leur
-- fiche technique réelle). Ne remplace jamais une saisie déjà faite.
update public.products set short_specs = E'- Moteur : Essence, 4 cylindres, 1 498 cm³, 109 ch à 113 ch\n- Boîte : Automatique\n- Transmission : Traction avant\n- Sécurité : 4 airbags, ABS, contrôle de stabilité, caméra de recul\n- Places : 5'
  where id = '23f79fc8-6033-46b1-ba18-884a464a2cd2' and short_specs is null;

update public.products set short_specs = E'- Moteur : Essence, 4 cylindres, 1 498 cm³, 109 ch à 113 ch\n- Boîte : Manuelle 5 rapports\n- Transmission : Traction avant\n- Sécurité : 4 airbags, ABS, contrôle de stabilité, caméra de recul\n- Places : 5'
  where id = 'c7ff183b-cc81-4731-a43d-c3423ac80ef6' and short_specs is null;

update public.products set short_specs = E'- Moteur : Essence, 4 cylindres, 1 500 cm³, 201 à 204 ch\n- Boîte : Automatique double embrayage (DCT)\n- Transmission : Traction avant\n- Sécurité : 6 airbags, ABS, EBD, EBA, ESP, caméra de recul\n- Places : 5'
  where id = '99d45972-06b4-4427-a86c-99b814dafebf' and short_specs is null;

update public.products set short_specs = E'- Moteur : Essence turbo, 4 cylindres, 1 498 cm³, 147 ch à 155 ch\n- Boîte : Automatique double embrayage (DCT)\n- Transmission : Traction avant (4x2)\n- Sécurité : 6 airbags, ABS, EBD, EBA, ESP, caméra de recul\n- Places : 5'
  where id = 'acba594d-904b-46ff-9d56-d46b94d18ab7' and short_specs is null;

update public.products set short_specs = E'- Moteur : Essence turbo, 4 cylindres, 261 ch\n- Boîte : Automatique double embrayage (DCT) 7 rapports\n- Transmission : Traction avant (FWD) ou intégrale (AWD)\n- Sécurité : 6 airbags, ABS, EBD, EBA, ESP, caméra de recul\n- Places : 7'
  where id = '52212d9d-a71d-4187-b1df-d7ea741a8736' and short_specs is null;

update public.products set short_specs = E'- Moteur : Diesel turbo, 4 cylindres, 2 298 cm³, 163 ch\n- Boîte : Automatique 6 rapports\n- Transmission : 4 roues motrices (4x4)\n- Sécurité : Airbags frontaux, latéraux et rideaux, ABS, EBD, EBA, ESP\n- Places : 5'
  where id = '89cf16d7-0a76-4f87-a70b-b20a0659a9a3' and short_specs is null;

update public.products set short_specs = E'- Moteur : Diesel turbo, 4 cylindres, 2 298 cm³, 163 ch\n- Boîte : Manuelle\n- Sécurité : Airbags frontaux, latéraux et rideaux, ABS, EBD, EBA, ESP\n- Places : 5'
  where id = '925692db-a8ae-4528-b523-53cddda4f547' and short_specs is null;
