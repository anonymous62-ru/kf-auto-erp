-- Corrections issues de la revue complète du 04/10 (soir), avant le démarrage.

-- ---------------------------------------------------------------------------
-- 1) Relances d'impayés : uniquement les FACTURES, y compris celles restées
--    en brouillon (remises en main propre). Un devis envoyé n'est pas un
--    impayé et ne doit pas déclencher d'alerte "Facture en retard".
-- ---------------------------------------------------------------------------
create or replace function generate_overdue_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_doc record;
  v_count integer := 0;
begin
  if auth.uid() is null then
    return 0;
  end if;
  for v_doc in
    select id, document_number, balance_due, commercial_id, organization_id
    from documents
    where organization_id = auth_org_id()
      and document_type = 'facture'
      and balance_due > 0
      and status not in ('paye', 'annule')
      and due_date < current_date
      and commercial_id is not null
      and (last_reminder_at is null or last_reminder_at < now() - interval '24 hours')
  loop
    insert into notifications (organization_id, user_id, type, title, message, related_document_id)
    values (
      v_doc.organization_id,
      v_doc.commercial_id,
      'relance_impaye',
      'Facture en retard',
      format('%s : %s FCFA restant, échéance dépassée', coalesce(v_doc.document_number, 'Une facture'), to_char(round(v_doc.balance_due), 'FM999G999G999')),
      v_doc.id
    );
    perform set_config('app.doc_guard_bypass', 'on', true);
    update documents set last_reminder_at = now() where id = v_doc.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function generate_overdue_reminders() from public, anon;
grant execute on function generate_overdue_reminders() to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Droits de lecture alignés sur les rôles réels
--    - Secrétaire (receptionniste_sav) : même accès que la caissière aux
--      prospects et contrats (le menu les affichait, les listes étaient vides).
--    - Chef d'atelier : voit les clients pour rattacher un ordre de
--      réparation (le responsable showroom reste exclu).
--    - Direction et accueil : voient le nom des collègues (colonne
--      "Commercial" de l'export, nom du commercial sur les PDF).
-- ---------------------------------------------------------------------------
alter policy prospects_select on prospects using (
  organization_id = auth_org_id() and (
    auth_role()::text in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav')
    or assigned_to = auth.uid()
  )
);

alter policy prospect_activities_select on prospect_activities using (
  exists (
    select 1 from prospects p
     where p.id = prospect_activities.prospect_id
       and p.organization_id = auth_org_id()
       and (auth_role()::text in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav') or p.assigned_to = auth.uid())
  )
);

alter policy prospect_appointments_select on prospect_appointments using (
  exists (
    select 1 from prospects p
     where p.id = prospect_appointments.prospect_id
       and p.organization_id = auth_org_id()
       and (auth_role()::text in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav') or p.assigned_to = auth.uid())
  )
);

alter policy sale_contracts_select on sale_contracts using (
  organization_id = auth_org_id() and (
    auth_role()::text in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav')
    or commercial_id = auth.uid()
  )
);

alter policy clients_select on clients using (
  organization_id = auth_org_id() and (
    auth_role()::text in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'chef_atelier')
    or assigned_to = auth.uid()
  )
);

create policy profiles_select_team on profiles for select using (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'chef_atelier')
);

-- ---------------------------------------------------------------------------
-- 3) Stock véhicules : le manager peut gérer les fiches et le stock ;
--    les mouvements de stock ne sont plus insérables par n'importe quel rôle
--    (avant : tout employé pouvait fausser l'historique ou bloquer la
--    déduction d'une facture). Les fonctions serveur (facture, suppression)
--    ne sont pas concernées.
-- ---------------------------------------------------------------------------
alter policy products_write on products using (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin', 'administrateur', 'manager', 'responsable_showroom')
) with check (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin', 'administrateur', 'manager', 'responsable_showroom')
);

alter policy stock_insert on stock_movements with check (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin', 'administrateur', 'manager', 'responsable_showroom')
  and reference_document_id is null
);

alter policy stock_write on stock_movements with check (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin', 'administrateur', 'manager', 'responsable_showroom')
  and reference_document_id is null
);

-- ---------------------------------------------------------------------------
-- 4) Pièces de l'atelier : réservation / consommation / libération faites
--    par une fonction serveur. Avant, un technicien ou la secrétaire
--    validait un devis ou terminait un OR, mais la mise à jour du stock de
--    pièces était bloquée en silence (droits d'écriture sur "parts").
-- ---------------------------------------------------------------------------
create or replace function apply_repair_order_parts(p_repair_order_id uuid, p_action text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_item record;
  v_part record;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié';
  end if;
  if p_action not in ('reserver', 'consommer', 'liberer') then
    raise exception 'Action inconnue';
  end if;
  if coalesce(auth_role()::text, '') not in ('super_admin', 'administrateur', 'manager', 'receptionniste_sav', 'chef_atelier', 'technicien', 'magasinier', 'responsable_showroom', 'comptable') then
    raise exception 'Vous n''avez pas les droits sur le stock de pièces.';
  end if;

  select id, organization_id, quote_status into v_order from repair_orders where id = p_repair_order_id;
  if v_order.id is null or v_order.organization_id is distinct from auth_org_id() then
    raise exception 'Ordre de réparation introuvable';
  end if;

  -- Vérification préalable du stock disponible avant toute réservation.
  if p_action = 'reserver' then
    for v_item in
      select i.part_id, sum(i.quantity) as quantity
        from repair_order_items i
       where i.repair_order_id = p_repair_order_id and i.item_type = 'piece' and i.part_id is not null
       group by i.part_id
    loop
      select designation, quantity_on_hand - quantity_reserved as dispo into v_part from parts where id = v_item.part_id;
      if v_part.dispo < v_item.quantity then
        raise exception 'Stock insuffisant pour "%" (disponible : %, demandé : %).', v_part.designation, v_part.dispo, v_item.quantity;
      end if;
    end loop;
  end if;

  for v_item in
    select i.part_id, sum(i.quantity) as quantity
      from repair_order_items i
      join parts p on p.id = i.part_id and p.organization_id = v_order.organization_id
     where i.repair_order_id = p_repair_order_id and i.item_type = 'piece'
     group by i.part_id
  loop
    if p_action = 'reserver' then
      update parts set quantity_reserved = quantity_reserved + v_item.quantity, updated_at = now() where id = v_item.part_id;
      insert into parts_stock_movements (organization_id, part_id, movement_type, quantity, reason, repair_order_id, performed_by)
      values (v_order.organization_id, v_item.part_id, 'reservation', v_item.quantity, 'Réservation devis OR', p_repair_order_id, auth.uid());
    elsif p_action = 'consommer' then
      update parts
         set quantity_on_hand = quantity_on_hand - v_item.quantity,
             quantity_reserved = case when v_order.quote_status = 'valide'
                                      then greatest(0, quantity_reserved - v_item.quantity)
                                      else quantity_reserved end,
             updated_at = now()
       where id = v_item.part_id;
      insert into parts_stock_movements (organization_id, part_id, movement_type, quantity, reason, repair_order_id, performed_by)
      values (v_order.organization_id, v_item.part_id, 'sortie', -v_item.quantity, 'Consommation OR', p_repair_order_id, auth.uid());
    else
      update parts set quantity_reserved = greatest(0, quantity_reserved - v_item.quantity), updated_at = now() where id = v_item.part_id;
      insert into parts_stock_movements (organization_id, part_id, movement_type, quantity, reason, repair_order_id, performed_by)
      values (v_order.organization_id, v_item.part_id, 'liberation', v_item.quantity, 'Annulation OR', p_repair_order_id, auth.uid());
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function apply_repair_order_parts(uuid, text) from public, anon;
grant execute on function apply_repair_order_parts(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Double authentification appliquée aussi aux données (pas seulement à
--    l'écran) : pour un compte qui a activé la 2FA, une session qui n'a pas
--    validé le code (niveau aal1) ne peut plus lire ni écrire aucune donnée,
--    même en appelant l'API directement avec un mot de passe volé.
--    Les comptes sans 2FA ne sont pas concernés. profiles et organizations
--    restent lisibles (écran de saisie du code).
-- ---------------------------------------------------------------------------
create or replace function mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
         where f.user_id = auth.uid() and f.status = 'verified'
      );
$$;

revoke all on function mfa_satisfied() from public, anon;
grant execute on function mfa_satisfied() to authenticated;

do $$
declare t record;
begin
  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
       and c.relname not in ('profiles', 'organizations')
       and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'mfa_required')
  loop
    execute format(
      'create policy mfa_required on public.%I as restrictive for all to authenticated using ((select mfa_satisfied())) with check ((select mfa_satisfied()))',
      t.relname
    );
  end loop;
end $$;
