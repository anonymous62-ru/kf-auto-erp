-- Modification d'un document (devis, proforma, facture...) déjà créé.
--
-- Cas réel : un commercial a choisi "Tiggo 4" au lieu de "Tiggo 2 Pro" et ne
-- pouvait plus corriger son document. On autorise désormais la modification
-- du client, des lignes et des notes. Le numéro, le type et le commercial ne
-- changent jamais.
--
-- Règles :
-- - un document qui a déjà un paiement n'est jamais modifiable (il faut
--   d'abord supprimer le paiement ou le document, action réservée à un
--   administrateur) ;
-- - le commercial propriétaire peut modifier son document tant qu'il est en
--   brouillon ou envoyé ;
-- - super_admin, administrateur, manager, comptable, receptionniste_sav
--   peuvent modifier quel que soit le statut (toujours sans paiement).
-- - facture : le stock retiré à la création est remis en place (mouvement
--   d'entrée, l'historique est conservé), puis le stock est de nouveau retiré
--   pour les nouvelles lignes.
--
-- A exécuter dans Supabase > SQL Editor (copier-coller tout le fichier).

create or replace function update_document_secure(
  p_document_id  uuid,
  p_client_id    uuid,
  p_notes        text,
  p_items        jsonb,
  p_subtotal     numeric,
  p_tax_amount   numeric,
  p_total_amount numeric
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc record;
  v_role text := coalesce(auth_role()::text, '');
  v_is_manager boolean;
  v_item jsonb;
  v_product_id uuid;
  v_qty numeric;
  v_price numeric;
  v_tax numeric;
  v_discount numeric;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_move record;
begin
  if auth.uid() is null then
    raise exception 'Session expirée, reconnectez-vous.';
  end if;

  -- Verrou sur le document : empêche un paiement ou une autre modification
  -- de passer en même temps.
  select id, organization_id, document_type, document_number, status, commercial_id, amount_paid
    into v_doc
    from documents
   where id = p_document_id
   for update;

  if v_doc.id is null or v_doc.organization_id is distinct from auth_org_id() then
    raise exception 'Document introuvable.';
  end if;

  v_is_manager := v_role in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav');

  if not v_is_manager then
    if v_doc.commercial_id is distinct from auth.uid() then
      raise exception 'Vous ne pouvez modifier que vos propres documents.';
    end if;
    if v_doc.status::text not in ('brouillon', 'envoye') then
      raise exception 'Ce document ne peut plus être modifié par un commercial (statut : %). Demandez à un responsable.', v_doc.status;
    end if;
  end if;

  if coalesce(v_doc.amount_paid, 0) > 0
     or exists (select 1 from payments where document_id = p_document_id) then
    raise exception 'Ce document a déjà un paiement enregistré : il ne peut pas être modifié. Un administrateur doit d''abord supprimer le paiement ou le document.';
  end if;

  if p_client_id is null or not exists (
    select 1 from clients where id = p_client_id and organization_id = v_doc.organization_id
  ) then
    raise exception 'Client introuvable.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Ajoutez au moins un article.';
  end if;

  -- Validation des lignes et recalcul des totaux (protection contre un appel
  -- direct à la fonction avec des montants incohérents).
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Article invalide.';
    end if;
    if coalesce(btrim(v_item->>'designation'), '') = '' then
      raise exception 'Chaque article doit avoir une désignation.';
    end if;

    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_tax := coalesce((v_item->>'tax_rate')::numeric, 0);
    v_discount := coalesce((v_item->>'discount_percent')::numeric, 0);

    if v_qty <= 0 then
      raise exception 'La quantité de chaque article doit être supérieure à zéro.';
    end if;
    if v_price < 0 then
      raise exception 'Le prix unitaire ne peut pas être négatif.';
    end if;
    if v_tax < 0 or v_tax > 100 then
      raise exception 'Taux de TVA invalide.';
    end if;
    if v_discount < 0 or v_discount > 100 then
      raise exception 'Remise invalide (entre 0 et 100 %%).';
    end if;

    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    if v_product_id is not null and not exists (
      select 1 from products where id = v_product_id and organization_id = v_doc.organization_id
    ) then
      raise exception 'Produit introuvable dans le catalogue.';
    end if;

    v_subtotal := v_subtotal + v_qty * v_price * (1 - v_discount / 100);
    v_tax_amount := v_tax_amount + v_qty * v_price * (1 - v_discount / 100) * (v_tax / 100);
  end loop;

  if p_subtotal is null or p_tax_amount is null or p_total_amount is null
     or abs(round(v_subtotal, 2) - p_subtotal) > 1
     or abs(round(v_tax_amount, 2) - p_tax_amount) > 1
     or abs(round(v_subtotal, 2) + round(v_tax_amount, 2) - p_total_amount) > 1 then
    raise exception 'Les totaux envoyés ne correspondent pas aux lignes. Rechargez la page et réessayez.';
  end if;

  -- Facture : remise en stock de ce que ce document avait retiré.
  if v_doc.document_type = 'facture' then
    for v_move in
      select product_id, sum(quantity) as quantity
        from stock_movements
       where reference_document_id = p_document_id
       group by product_id
      having sum(quantity) <> 0
    loop
      update products
         set quantity_on_hand = coalesce(quantity_on_hand, 0) - v_move.quantity,
             updated_at = now()
       where id = v_move.product_id;
      insert into stock_movements (organization_id, product_id, movement_type, quantity, reason, reference_document_id, performed_by)
      values (v_doc.organization_id, v_move.product_id, 'entree', -v_move.quantity,
              'Modification facture ' || coalesce(v_doc.document_number, ''), p_document_id, auth.uid());
    end loop;
  end if;

  -- Remplacement des lignes.
  delete from document_items where document_id = p_document_id;

  insert into document_items (document_id, product_id, designation, quantity, unit_price, tax_rate, discount_percent, position)
  select p_document_id,
         nullif(e.value->>'product_id', '')::uuid,
         btrim(e.value->>'designation'),
         (e.value->>'quantity')::numeric,
         coalesce((e.value->>'unit_price')::numeric, 0),
         coalesce((e.value->>'tax_rate')::numeric, 0),
         coalesce((e.value->>'discount_percent')::numeric, 0),
         coalesce((e.value->>'position')::int, (e.ord - 1)::int)
    from jsonb_array_elements(p_items) with ordinality as e(value, ord);

  -- Facture : nouvelle sortie de stock pour les nouvelles lignes (même
  -- logique que apply_facture_stock, faite ici car cette fonction refuse de
  -- s'exécuter deux fois pour un même document).
  if v_doc.document_type = 'facture' then
    for v_move in
      select di.product_id, sum(di.quantity) as quantity
        from document_items di
        join products p on p.id = di.product_id and p.organization_id = v_doc.organization_id
       where di.document_id = p_document_id and di.product_id is not null
       group by di.product_id
    loop
      update products
         set quantity_on_hand = coalesce(quantity_on_hand, 0) - v_move.quantity,
             updated_at = now()
       where id = v_move.product_id;
      insert into stock_movements (organization_id, product_id, movement_type, quantity, reason, reference_document_id, performed_by)
      values (v_doc.organization_id, v_move.product_id, 'sortie', -v_move.quantity,
              'Vente facture ' || coalesce(v_doc.document_number, '') || ' (modifiée)', p_document_id, auth.uid());
    end loop;
  end if;

  -- Fonction de confiance : autorise la mise à jour des montants malgré
  -- protect_document_financials (pour cette transaction uniquement).
  perform set_config('app.doc_guard_bypass', 'on', true);

  update documents
     set client_id = p_client_id,
         notes = nullif(btrim(coalesce(p_notes, '')), ''),
         -- Montants calculés par computeDocumentTotals (comme à la création),
         -- vérifiés ci-dessus à 1 FCFA près.
         subtotal = p_subtotal,
         tax_amount = p_tax_amount,
         total_amount = p_total_amount,
         updated_at = now()
   where id = p_document_id;

  perform set_config('app.doc_guard_bypass', 'off', true);

  return 'ok';
end;
$$;

revoke all on function update_document_secure(uuid, uuid, text, jsonb, numeric, numeric, numeric) from public, anon;
grant execute on function update_document_secure(uuid, uuid, text, jsonb, numeric, numeric, numeric) to authenticated;
