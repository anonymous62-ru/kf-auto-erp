-- Suppression des documents et des produits, et déduction du stock à la
-- facturation, regroupées dans des fonctions côté base (security definer).
--
-- Pourquoi côté base :
-- 1) Déduction du stock : un commercial n'a pas le droit (RLS products_write)
--    de modifier products.quantity_on_hand. La déduction faite depuis
--    l'application échouait donc EN SILENCE pour les commerciaux (0 ligne
--    modifiée, aucune erreur) : la facture était créée mais le stock ne
--    bougeait pas. La fonction relit elle-même les lignes de la facture (on
--    ne fait pas confiance aux quantités envoyées par le navigateur) et ne
--    s'applique qu'une fois par facture.
-- 2) Suppression d'un document : les factures de test avaient presque toutes
--    un paiement de test, et l'application refusait (volontairement) de les
--    supprimer, avec un message que Next.js masquait en production. Un
--    administrateur peut désormais supprimer un document AVEC ses paiements,
--    après une confirmation explicite. Le stock retiré par la facture est
--    remis en place par un mouvement d'entrée (l'historique est conservé).
-- 3) Suppression d'un produit : n'existait pas. Un produit jamais utilisé
--    est supprimé ; un produit présent dans un devis/facture/contrat/
--    garantie est archivé (retiré du catalogue) pour ne pas casser ces
--    documents.

-- ---------------------------------------------------------------------------
-- 1) Déduction du stock à la facturation
-- ---------------------------------------------------------------------------
create or replace function apply_facture_stock(p_document_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc record;
  v_item record;
  v_count integer := 0;
begin
  select id, organization_id, document_type, document_number, commercial_id
    into v_doc
    from documents
   where id = p_document_id;

  if v_doc.id is null or v_doc.organization_id <> auth_org_id() then
    raise exception 'Document introuvable';
  end if;
  if v_doc.document_type <> 'facture' then
    return 0;
  end if;
  if v_doc.commercial_id <> auth.uid()
     and auth_role()::text not in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav') then
    raise exception 'Accès refusé à ce document';
  end if;

  -- Une seule déduction par facture, même si la fonction est rappelée
  -- (double clic, nouvelle synchronisation hors-ligne...).
  if exists (
    select 1 from stock_movements
     where reference_document_id = p_document_id and movement_type = 'sortie'
  ) then
    return 0;
  end if;

  for v_item in
    select di.product_id, sum(di.quantity) as quantity
      from document_items di
      join products p on p.id = di.product_id and p.organization_id = v_doc.organization_id
     where di.document_id = p_document_id and di.product_id is not null
     group by di.product_id
  loop
    update products
       set quantity_on_hand = coalesce(quantity_on_hand, 0) - v_item.quantity,
           updated_at = now()
     where id = v_item.product_id;

    insert into stock_movements (organization_id, product_id, movement_type, quantity, reason, reference_document_id, performed_by)
    values (v_doc.organization_id, v_item.product_id, 'sortie', -v_item.quantity,
            'Vente facture ' || coalesce(v_doc.document_number, ''), p_document_id, auth.uid());
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function apply_facture_stock(uuid) from public, anon;
grant execute on function apply_facture_stock(uuid) to authenticated;

