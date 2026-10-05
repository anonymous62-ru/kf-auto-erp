-- Nouveau rôle "responsable_showroom" : vue d'ensemble sur le stock
-- véhicules, l'atelier/SAV, le magasin de pièces et les garanties
-- constructeur — mais SANS AUCUNE visibilité sur les commerciaux
-- (contrairement au rôle "manager", qui voit déjà tous les clients/devis/
-- factures/contrats/prospects de l'organisation, voir policies de
-- 0001_init.sql / 0010_prospects.sql / 0013_sale_contracts.sql).
--
-- Ce rôle n'est volontairement AJOUTÉ à aucune des policies
-- clients_select / documents_select / prospects_select /
-- sale_contracts_select : comme il n'est pas non plus "assigned_to" ou
-- "commercial_id" sur ces lignes, la RLS ne lui renverra jamais aucune
-- ligne appartenant à un commercial. C'est le mécanisme d'isolation lui-
-- même, pas une liste d'exclusion à maintenir.
--
-- Écrit de façon idempotente comme les migrations précédentes.

do $$ begin
  if not exists (select 1 from pg_enum where enumlabel = 'responsable_showroom' and enumtypid = 'user_role'::regtype) then
    alter type user_role add value 'responsable_showroom';
  end if;
end $$;

-- Rappel (voir 0016) : la valeur d'enum qu'on vient d'ajouter ne peut pas
-- être utilisée comme littéral enum dans la même transaction/script — toutes
-- les comparaisons ci-dessous passent donc par auth_role()::text.

-- ---------- Stock véhicules (products) : le responsable showroom peut gérer les fiches ----------
drop policy if exists products_write on products;
create policy products_write on products for all using (
  organization_id = auth_org_id() and auth_role()::text in ('super_admin','administrateur','responsable_showroom')
) with check (
  organization_id = auth_org_id() and auth_role()::text in ('super_admin','administrateur','responsable_showroom')
);

-- ---------- Magasin de pièces ----------
drop policy if exists parts_write on parts;
create policy parts_write on parts for all using (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','magasinier','chef_atelier','responsable_showroom')
) with check (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','magasinier','chef_atelier','responsable_showroom')
);

drop policy if exists parts_moves_insert on parts_stock_movements;
create policy parts_moves_insert on parts_stock_movements for insert with check (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','magasinier','chef_atelier','responsable_showroom')
);

-- ---------- Atelier / SAV ----------
drop policy if exists appointments_write on workshop_appointments;
create policy appointments_write on workshop_appointments for all using (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','commercial','receptionniste_sav','chef_atelier','responsable_showroom')
) with check (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','commercial','receptionniste_sav','chef_atelier','responsable_showroom')
);

drop policy if exists repair_orders_insert on repair_orders;
create policy repair_orders_insert on repair_orders for insert with check (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','receptionniste_sav','chef_atelier','responsable_showroom')
);

drop policy if exists repair_orders_update on repair_orders;
create policy repair_orders_update on repair_orders for update using (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','receptionniste_sav','chef_atelier','technicien','comptable','responsable_showroom')
);

drop policy if exists or_items_write on repair_order_items;
create policy or_items_write on repair_order_items for all using (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','receptionniste_sav','chef_atelier','technicien','responsable_showroom')
) with check (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','receptionniste_sav','chef_atelier','technicien','responsable_showroom')
);

-- ---------- Garanties constructeur ----------
drop policy if exists warranties_write on vehicle_warranties;
create policy warranties_write on vehicle_warranties for all using (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','receptionniste_sav','chef_atelier','comptable','responsable_showroom')
) with check (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','receptionniste_sav','chef_atelier','comptable','responsable_showroom')
);

drop policy if exists claims_write on warranty_claims;
create policy claims_write on warranty_claims for all using (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','chef_atelier','comptable','responsable_showroom')
) with check (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','chef_atelier','comptable','responsable_showroom')
);
