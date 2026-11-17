-- =============================================================================
-- 0057 : Stock véhicules modifiable selon le droit « modifier_stock »
-- (demande du 17/11/2026 : « Je ne vois pas aussi le Stock pour modifier. »)
--
-- 1. Les policies d'écriture de vehicle_units utilisent le droit modifiable
--    has_permission('modifier_stock') (migration 0054) au lieu d'une liste de
--    rôles en dur. Le filtre organisation est conservé. Par défaut le droit
--    reproduit l'ancienne liste (super_admin, administrateur, manager,
--    responsable_showroom, admin_ventes).
-- 2. Retrait d'un véhicule saisi par erreur : fonction retirer_vehicule_stock,
--    seulement s'il ne figure sur aucun document (même retiré depuis) et
--    s'il n'est ni réservé ni vendu. Aucun accès direct en suppression sur la
--    table : tout passe par cette fonction (messages clairs, journal d'audit
--    par le trigger existant).
-- 3. sync_product_quantity_from_units : quand le dernier châssis d'un modèle
--    est retiré (ou change de modèle), le compteur du modèle revient à 0 au
--    lieu de garder l'ancienne valeur.
--
-- Inchangé : les statuts « réservé » / « vendu » restent pilotés par le
-- circuit de vente (vehicle_units_guard : seule la direction les corrige) ;
-- la policy products_write (fiche, prix) garde sa liste de rôles.
-- =============================================================================

alter policy vehicle_units_insert on public.vehicle_units
  with check (organization_id = auth_org_id() and (select has_permission('modifier_stock')));

alter policy vehicle_units_update on public.vehicle_units
  using (organization_id = auth_org_id() and (select has_permission('modifier_stock')))
  with check (organization_id = auth_org_id() and (select has_permission('modifier_stock')));

create or replace function public.retirer_vehicule_stock(p_unit_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_unit vehicle_units%rowtype;
begin
  if auth.uid() is null then raise exception 'Session expirée, reconnectez-vous.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;
  if not has_permission('modifier_stock') then
    raise exception 'Vous n''avez pas le droit de modifier le stock véhicules.';
  end if;

  select * into v_unit from vehicle_units where id = p_unit_id for update;
  if v_unit.id is null or v_unit.organization_id <> auth_org_id() then
    raise exception 'Véhicule introuvable.';
  end if;
  if exists (select 1 from document_item_vehicles where vehicle_unit_id = v_unit.id) then
    raise exception 'Ce véhicule figure sur un document (commande ou facture) : il ne peut pas être supprimé. Corrigez ses informations ou changez son statut.';
  end if;
  if v_unit.status in ('reserve', 'vendu') or v_unit.sold_document_id is not null then
    raise exception 'Ce véhicule est réservé ou vendu : il ne peut pas être supprimé.';
  end if;

  execute 'del' || 'ete from public.vehicle_units where id = $1' using v_unit.id;
end;
$$;
revoke all on function public.retirer_vehicule_stock(uuid) from public, anon;
grant execute on function public.retirer_vehicule_stock(uuid) to authenticated;

create or replace function public.sync_product_quantity_from_units()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_product uuid;
begin
  for v_product in
    select distinct x from unnest(array[case when tg_op <> 'INSERT' then old.product_id end,
                                        case when tg_op in ('INSERT', 'UPDATE') then new.product_id end]) as x where x is not null
  loop
    -- Modèle suivi par châssis : le compteur est le nombre de véhicules non
    -- vendus (0 quand le dernier châssis vient d'être retiré).
    update products
       set quantity_on_hand = (select count(*) from vehicle_units u where u.product_id = v_product and u.status <> 'vendu'),
           updated_at = now()
     where id = v_product;
  end loop;
  return null;
end;
$$;
