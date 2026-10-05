-- Fonctions de suppression sécurisée (document avec paiements, produit).
-- Voir le commentaire en tête de 0022_stock_facture.sql pour le contexte.
-- A exécuter dans Supabase > SQL Editor (copier-coller tout le fichier).
--
-- Règle du 04/10 (soir) : seuls super_admin, administrateur et manager
-- suppriment, et ils peuvent supprimer n'importe quel document (accepté,
-- signé, payé...). Les commerciaux ne suppriment rien. Les paiements d'un
-- document sont supprimés avec lui après une confirmation explicite.
-- Aucun accès sans compte (auth.uid() obligatoire, droit retiré à anon).

-- ---------------------------------------------------------------------------
-- 2) Suppression d'un document (avec ses paiements si un admin le confirme)
-- ---------------------------------------------------------------------------
create or replace function delete_document_secure(p_document_id uuid, p_with_payments boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc record;
  v_role text := auth_role()::text;
  v_paid numeric;
  v_move record;
begin
  select id, organization_id, document_number, commercial_id, parent_document_id
    into v_doc
    from documents
   where id = p_document_id;

  if auth.uid() is null then
    raise exception 'Non authentifié';
  end if;
  if v_doc.id is null or v_doc.organization_id is distinct from auth_org_id() then
    raise exception 'Document introuvable';
  end if;

  if coalesce(v_role, '') not in ('super_admin', 'administrateur', 'manager') then
    raise exception 'Seuls l''administrateur et le manager peuvent supprimer un document.';
  end if;

  select coalesce(sum(amount), 0) into v_paid from payments where document_id = p_document_id;
  if v_paid > 0 and not p_with_payments then
    raise exception 'PAIEMENTS_A_CONFIRMER';
  end if;

  -- Remise en stock de ce que la facture avait retiré (mouvement d'entrée :
  -- on garde la trace de la vente puis de son annulation).
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
            'Annulation (document supprimé) ' || coalesce(v_doc.document_number, ''), p_document_id, auth.uid());
  end loop;

  delete from payments where document_id = p_document_id;
  delete from documents where id = p_document_id;

  -- Facture issue d'un devis/proforma : le devis redevient convertible.
  if v_doc.parent_document_id is not null then
    update documents set status = 'envoye'
     where id = v_doc.parent_document_id and status = 'accepte';
  end if;
  return 'ok';
end;
$$;

revoke all on function delete_document_secure(uuid, boolean) from public, anon;
grant execute on function delete_document_secure(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Suppression (ou archivage) d'un produit
-- ---------------------------------------------------------------------------
create or replace function delete_product_secure(p_product_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié';
  end if;
  select organization_id into v_org from products where id = p_product_id;
  if v_org is null or v_org is distinct from auth_org_id() then
    raise exception 'Produit introuvable';
  end if;
  if coalesce(auth_role()::text, '') not in ('super_admin', 'administrateur', 'manager', 'responsable_showroom') then
    raise exception 'Vous n''avez pas les droits pour supprimer un produit.';
  end if;

  if exists (select 1 from document_items where product_id = p_product_id)
     or exists (select 1 from sale_contracts where product_id = p_product_id)
     or exists (select 1 from vehicle_warranties where product_id = p_product_id) then
    update products set is_active = false, is_archived = true, updated_at = now() where id = p_product_id;
    return 'archived';
  end if;

  delete from stock_movements where product_id = p_product_id;
  update prospects set vehicle_interest_id = null where vehicle_interest_id = p_product_id;
  delete from products where id = p_product_id;
  return 'deleted';
end;
$$;

revoke all on function delete_product_secure(uuid) from public, anon;
grant execute on function delete_product_secure(uuid) to authenticated;
