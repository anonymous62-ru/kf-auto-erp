-- Retours de la direction du 09/10/2026, étape 2 : stock véhicules.
--
-- Chaque véhicule physique (numéro de châssis) devient une ligne de
-- vehicle_units, rattachée à son modèle du catalogue (products), avec :
--   - un statut : disponible, reserve (acompte versé), demo (plaque démo),
--     essai (réservé pour essais), endommage, vendu ;
--   - une date d'entrée en stock (ancienneté calculée à l'affichage).
--
-- Lien avec le circuit de vente : sur une commande ou une facture, chaque
-- ligne véhicule reçoit ses numéros de châssis (table document_item_vehicles).
-- Un véhicule choisi n'est plus proposé aux autres commerciaux. Au premier
-- versement sur la facture il passe "réservé (acompte versé)", au paiement
-- complet "vendu". Une facture de véhicule ne peut être établie qu'une fois
-- les châssis choisis.
--
-- Le compteur products.quantity_on_hand d'un modèle suivi par châssis est
-- recalculé automatiquement (véhicules non vendus). Les modèles sans aucun
-- châssis saisi gardent l'ancien fonctionnement (compteur décrémenté à la facture).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists vehicle_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  product_id uuid not null references products(id),
  vin text not null,
  color text,
  model_year integer,
  entry_date date not null default current_date,
  status text not null default 'disponible'
    check (status in ('disponible', 'reserve', 'demo', 'essai', 'endommage', 'vendu')),
  location text,
  notes text,
  sold_document_id uuid references documents(id) on delete set null,
  sold_at timestamptz,
  status_changed_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists vehicle_units_org_vin_uidx on vehicle_units (organization_id, upper(vin));
create index if not exists vehicle_units_product_idx on vehicle_units (product_id, status);
alter table vehicle_units enable row level security;

create table if not exists document_item_vehicles (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  document_item_id uuid not null references document_items(id) on delete cascade,
  vehicle_unit_id uuid not null references vehicle_units(id),
  created_at timestamptz not null default now(),
  -- Un châssis retiré d'une ligne n'est pas effacé : le lien est marqué
  -- "retiré", ce qui garde l'historique des changements.
  removed_at timestamptz,
  unique (document_item_id, vehicle_unit_id)
);
create index if not exists document_item_vehicles_unit_idx on document_item_vehicles (vehicle_unit_id);
create index if not exists document_item_vehicles_doc_idx on document_item_vehicles (document_id);
alter table document_item_vehicles enable row level security;

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------
do $$ begin
  create policy vehicle_units_select on vehicle_units for select using (organization_id = auth_org_id());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy vehicle_units_insert on vehicle_units for insert with check (
    organization_id = auth_org_id()
    and auth_role()::text in ('super_admin', 'administrateur', 'manager', 'responsable_showroom', 'admin_ventes'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy vehicle_units_update on vehicle_units for update using (
    organization_id = auth_org_id()
    and auth_role()::text in ('super_admin', 'administrateur', 'manager', 'responsable_showroom', 'admin_ventes'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mfa_required on vehicle_units as restrictive for all to authenticated using ((select mfa_satisfied()));
exception when duplicate_object then null; end $$;

-- Liens châssis <-> lignes de document : lecture comme les lignes du
-- document ; écriture uniquement par la fonction set_item_vehicles.
do $$ begin
  create policy document_item_vehicles_select on document_item_vehicles for select using (
    exists (select 1 from documents d
             where d.id = document_item_vehicles.document_id and d.organization_id = auth_org_id()
               and (auth_role()::text = any (array['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes'])
                    or d.commercial_id = auth.uid())));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mfa_required on document_item_vehicles as restrictive for all to authenticated using ((select mfa_satisfied()));
exception when duplicate_object then null; end $$;

-- Garde : les statuts "réservé" et "vendu" sont posés par les paiements ;
-- la direction peut tout corriger à la main.
create or replace function public.vehicle_units_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_internal boolean := pg_trigger_depth() > 1 or auth.uid() is null
                        or coalesce(current_setting('app.doc_guard_bypass', true), '') = 'on';
  v_role text := coalesce(auth_role()::text, '');
  v_direction boolean := v_role in ('super_admin', 'administrateur', 'manager');
begin
  new.vin := upper(trim(new.vin));
  if new.vin = '' then
    raise exception 'Le numéro de châssis est obligatoire.';
  end if;
  new.updated_at := now();

  if tg_op = 'INSERT' then
    if not v_internal then
      new.created_by := auth.uid();
      new.sold_document_id := null;
      new.sold_at := null;
      if new.status in ('reserve', 'vendu') and not v_direction then
        new.status := 'disponible';
      end if;
    end if;
    if not exists (select 1 from products p where p.id = new.product_id and p.organization_id = new.organization_id) then
      raise exception 'Modèle de véhicule introuvable.';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;

  if not v_internal and not v_direction then
    if new.sold_document_id is distinct from old.sold_document_id or new.sold_at is distinct from old.sold_at then
      raise exception 'La vente d''un véhicule est enregistrée par le paiement de sa facture.';
    end if;
    if new.status is distinct from old.status
       and (new.status in ('reserve', 'vendu') or old.status in ('reserve', 'vendu')) then
      raise exception 'Les statuts « réservé » et « vendu » suivent les paiements ; seule la direction peut les corriger.';
    end if;
    if new.product_id is distinct from old.product_id
       and exists (select 1 from document_item_vehicles where vehicle_unit_id = old.id) then
      raise exception 'Ce véhicule figure déjà sur un document : son modèle ne peut plus changer.';
    end if;
  end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_vehicle_units_guard') then
    create trigger trg_vehicle_units_guard before insert or update on vehicle_units
      for each row execute function vehicle_units_guard();
  end if;
end $$;

-- Compteur du modèle = véhicules non vendus.
create or replace function public.sync_product_quantity_from_units()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_product uuid;
begin
  for v_product in
    select distinct x from unnest(array[case when tg_op <> 'INSERT' then old.product_id end,
                                        case when tg_op <> 'DELETE' then new.product_id end]) as x where x is not null
  loop
    update products
       set quantity_on_hand = (select count(*) from vehicle_units u where u.product_id = v_product and u.status <> 'vendu'),
           updated_at = now()
     where id = v_product
       and exists (select 1 from vehicle_units u where u.product_id = v_product);
  end loop;
  return null;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_sync_product_quantity') then
    create trigger trg_sync_product_quantity after insert or update or delete on vehicle_units
      for each row execute function sync_product_quantity_from_units();
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_audit_vehicle_units') then
    create trigger trg_audit_vehicle_units after insert or update or delete on vehicle_units
      for each row execute function audit_trigger_fn();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Document actif d'un véhicule (dernier document non annulé qui le cite)
-- ---------------------------------------------------------------------------
create or replace function public.vehicle_unit_active_document(p_unit_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select d.id
    from document_item_vehicles v
    join documents d on d.id = v.document_id
   where v.vehicle_unit_id = p_unit_id
     and v.removed_at is null
     and d.status::text not in ('annule', 'refuse')
   order by d.created_at desc
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Choix des châssis d'une ligne de commande ou de facture
-- ---------------------------------------------------------------------------
create or replace function public.set_item_vehicles(p_item_id uuid, p_unit_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(auth_role()::text, '');
  v_item record;
  v_doc documents%rowtype;
  v_unit record;
  v_other uuid;
  v_ids uuid[] := coalesce(p_unit_ids, '{}');
  v_count integer;
begin
  if auth.uid() is null then raise exception 'Session expirée, reconnectez-vous.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;

  select * into v_item from document_items where id = p_item_id;
  if v_item.id is null then raise exception 'Ligne introuvable.'; end if;
  select * into v_doc from documents where id = v_item.document_id;
  if v_doc.id is null or v_doc.organization_id <> auth_org_id() then raise exception 'Document introuvable.'; end if;
  if v_doc.document_type::text not in ('commande', 'facture') then
    raise exception 'Les châssis se choisissent sur une commande ou une facture.';
  end if;
  if v_doc.commercial_id <> auth.uid() and v_role not in ('super_admin', 'administrateur', 'manager', 'admin_ventes') then
    raise exception 'Vous ne pouvez modifier que vos propres commandes.';
  end if;
  if v_doc.status::text in ('annule', 'refuse') then raise exception 'Ce document est annulé.'; end if;
  if v_doc.document_type::text = 'commande' and v_doc.status::text = 'accepte' then
    raise exception 'Cette commande est déjà facturée : choisissez les châssis sur la facture.';
  end if;
  if v_doc.status::text in ('paye', 'paye_partiel') and v_role not in ('super_admin', 'administrateur', 'manager') then
    raise exception 'Un paiement a été enregistré : seule la direction peut changer les châssis.';
  end if;

  select count(distinct x) into v_count from unnest(v_ids) x;
  if v_count <> coalesce(array_length(v_ids, 1), 0) then raise exception 'Un même châssis est choisi deux fois.'; end if;
  if v_count > v_item.quantity then
    raise exception 'Cette ligne compte % véhicule(s) : choisissez au plus % châssis.', v_item.quantity::int, v_item.quantity::int;
  end if;

  for v_unit in select * from vehicle_units where id = any (v_ids) loop
    if v_unit.organization_id <> v_doc.organization_id then raise exception 'Véhicule introuvable.'; end if;
    if v_unit.product_id is distinct from v_item.product_id then
      raise exception 'Le châssis % ne correspond pas au modèle de la ligne.', v_unit.vin;
    end if;
    if v_unit.status in ('vendu', 'endommage') then
      raise exception 'Le châssis % n''est pas disponible (%).', v_unit.vin, v_unit.status;
    end if;
    -- Pris par un autre dossier (hors chaîne proforma/commande/facture de ce document) ?
    select vehicle_unit_active_document(v_unit.id) into v_other;
    if v_other is not null and v_other <> v_doc.id and v_other is distinct from v_doc.parent_document_id then
      raise exception 'Le châssis % est déjà attribué à un autre dossier.', v_unit.vin;
    end if;
  end loop;
  if (select count(*) from vehicle_units where id = any (v_ids)) <> v_count then
    raise exception 'Véhicule introuvable.';
  end if;

  update document_item_vehicles set removed_at = now()
   where document_item_id = p_item_id and removed_at is null and not (vehicle_unit_id = any (v_ids));
  insert into document_item_vehicles (document_id, document_item_id, vehicle_unit_id)
  select v_doc.id, p_item_id, x from unnest(v_ids) x
  on conflict (document_item_id, vehicle_unit_id) do update set removed_at = null;

  -- Facture déjà payée en partie : les nouveaux châssis passent réservés.
  if v_doc.document_type::text = 'facture' and v_doc.amount_paid > 0 then
    perform set_config('app.doc_guard_bypass', 'on', true);
    update vehicle_units
       set status = case when v_doc.amount_paid >= v_doc.total_amount then 'vendu' else 'reserve' end,
           sold_document_id = case when v_doc.amount_paid >= v_doc.total_amount then v_doc.id else sold_document_id end,
           sold_at = case when v_doc.amount_paid >= v_doc.total_amount then now() else sold_at end
     where id = any (v_ids) and status not in ('vendu');
    perform set_config('app.doc_guard_bypass', 'off', true);
  end if;

  return v_count;
end;
$$;
revoke all on function public.set_item_vehicles(uuid, uuid[]) from public, anon;
grant execute on function public.set_item_vehicles(uuid, uuid[]) to authenticated;

-- Châssis retiré (choix modifié, document supprimé) : s'il n'est plus sur une
-- facture payée active, il n'est plus réservé ni vendu.
create or replace function public.release_vehicle_unit_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_unit uuid := case when tg_op = 'DELETE' then old.vehicle_unit_id else new.vehicle_unit_id end;
  v_active uuid;
  v_doc record;
begin
  if tg_op = 'UPDATE' and (new.removed_at is null or old.removed_at is not null) then
    return new;
  end if;
  v_active := vehicle_unit_active_document(v_unit);
  if v_active is not null then
    select document_type::text as t, amount_paid into v_doc from documents where id = v_active;
  end if;
  if v_active is null or v_doc.t <> 'facture' or coalesce(v_doc.amount_paid, 0) = 0 then
    update vehicle_units
       set status = 'disponible', sold_document_id = null, sold_at = null
     where id = v_unit and status in ('reserve', 'vendu');
  end if;
  return null;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_release_vehicle_unit_link') then
    create trigger trg_release_vehicle_unit_link after update or delete on document_item_vehicles
      for each row execute function release_vehicle_unit_link();
  end if;
end $$;

-- Paiement d'une facture : châssis réservés (acompte) puis vendus (soldé).
create or replace function public.vehicle_units_on_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_doc record;
begin
  select id, document_type, amount_paid, total_amount into v_doc from documents where id = new.document_id;
  if v_doc.id is null or v_doc.document_type::text <> 'facture' then
    return new;
  end if;
  if v_doc.amount_paid >= v_doc.total_amount then
    update vehicle_units u
       set status = 'vendu', sold_document_id = v_doc.id, sold_at = now()
     where u.id in (select vehicle_unit_id from document_item_vehicles where document_id = v_doc.id and removed_at is null)
       and u.status <> 'vendu';
  elsif v_doc.amount_paid > 0 then
    update vehicle_units u
       set status = 'reserve'
     where u.id in (select vehicle_unit_id from document_item_vehicles where document_id = v_doc.id and removed_at is null)
       and u.status not in ('vendu', 'reserve');
  end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_vehicle_units_on_payment') then
    create trigger trg_vehicle_units_on_payment after insert on payments
      for each row execute function vehicle_units_on_payment();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Liste du stock (avec le dossier qui a retenu chaque véhicule)
-- ---------------------------------------------------------------------------
create or replace function public.list_vehicle_units()
returns table (
  id uuid, product_id uuid, model text, vin text, color text, model_year integer, entry_date date,
  status text, location text, notes text, status_changed_at timestamptz, sold_at timestamptz,
  document_id uuid, document_type text, document_number text, commercial_name text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or auth_org_id() is null then raise exception 'Accès refusé.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;
  return query
  select u.id, u.product_id, p.designation, u.vin, u.color, u.model_year, u.entry_date,
         u.status, u.location, u.notes, u.status_changed_at, u.sold_at,
         d.id, d.document_type::text, d.document_number, pr.full_name
    from vehicle_units u
    join products p on p.id = u.product_id
    left join lateral (
      select dd.* from document_item_vehicles v join documents dd on dd.id = v.document_id
       where v.vehicle_unit_id = u.id and v.removed_at is null and dd.status::text not in ('annule', 'refuse')
       order by dd.created_at desc limit 1
    ) d on true
    left join profiles pr on pr.id = d.commercial_id
   where u.organization_id = auth_org_id()
   order by u.entry_date asc, u.created_at asc;
end;
$$;
revoke all on function public.list_vehicle_units() from public, anon;
grant execute on function public.list_vehicle_units() to authenticated;

-- ---------------------------------------------------------------------------
-- Facture : stock par châssis pour les modèles suivis
-- ---------------------------------------------------------------------------
create or replace function public.apply_facture_stock(p_document_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_doc record;
  v_item record;
  v_count integer := 0;
begin
  select id, organization_id, document_type, document_number, commercial_id
    into v_doc from documents where id = p_document_id;

  if v_doc.id is null or v_doc.organization_id <> auth_org_id() then
    raise exception 'Document introuvable';
  end if;
  if v_doc.document_type <> 'facture' then
    return 0;
  end if;
  if v_doc.commercial_id <> auth.uid()
     and auth_role()::text not in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes') then
    raise exception 'Accès refusé à ce document';
  end if;

  if exists (select 1 from stock_movements where reference_document_id = p_document_id and movement_type = 'sortie') then
    return 0;
  end if;

  for v_item in
    select di.product_id, sum(di.quantity) as quantity
      from document_items di
      join products p on p.id = di.product_id and p.organization_id = v_doc.organization_id
     where di.document_id = p_document_id and di.product_id is not null
       -- Modèle suivi par châssis : son compteur suit les véhicules, pas les factures.
       and not exists (select 1 from vehicle_units u where u.product_id = di.product_id)
     group by di.product_id
  loop
    update products set quantity_on_hand = coalesce(quantity_on_hand, 0) - v_item.quantity, updated_at = now()
     where id = v_item.product_id;
    insert into stock_movements (organization_id, product_id, movement_type, quantity, reason, reference_document_id, performed_by)
    values (v_doc.organization_id, v_item.product_id, 'sortie', -v_item.quantity,
            'Vente facture ' || coalesce(v_doc.document_number, ''), p_document_id, auth.uid());
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Conversion : les châssis suivent la commande vers la facture
-- ---------------------------------------------------------------------------
create or replace function public.convert_document(p_source_id uuid, p_target text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(auth_role()::text, '');
  v_src documents%rowtype;
  v_existing uuid;
  v_number text;
  v_new uuid;
  v_user record;
  v_missing text;
begin
  if auth.uid() is null then
    raise exception 'Session expirée, reconnectez-vous.';
  end if;
  if not mfa_satisfied() then
    raise exception 'Double authentification requise.';
  end if;

  select * into v_src from documents where id = p_source_id;
  if v_src.id is null or v_src.organization_id <> auth_org_id() then
    raise exception 'Document introuvable.';
  end if;

  if p_target = 'commande' then
    if v_src.document_type::text not in ('devis', 'proforma') then
      raise exception 'Seule une facture proforma peut être convertie en commande.';
    end if;
    if v_src.commercial_id <> auth.uid()
       and v_role not in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes') then
      raise exception 'Vous ne pouvez convertir que vos propres factures proforma.';
    end if;
  elsif p_target = 'facture' then
    if v_src.document_type::text <> 'commande' then
      raise exception 'Seule une commande peut être convertie en facture.';
    end if;
    if v_role not in ('super_admin', 'administrateur', 'manager', 'admin_ventes') then
      raise exception 'Seule l''administration des ventes peut établir une facture.';
    end if;
  else
    raise exception 'Conversion non prise en charge.';
  end if;

  if v_src.status::text in ('annule', 'refuse') then
    raise exception 'Ce document est annulé ou refusé : il ne peut pas être converti.';
  end if;

  select id into v_existing from documents
   where parent_document_id = v_src.id and document_type::text = p_target
   order by created_at limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  if not exists (select 1 from document_items where document_id = v_src.id) then
    raise exception 'Ce document ne contient aucun article.';
  end if;

  -- Facture d'un véhicule suivi par châssis : tous les châssis doivent être choisis.
  if p_target = 'facture' then
    select string_agg(di.designation, ', ') into v_missing
      from document_items di
     where di.document_id = v_src.id and di.product_id is not null
       and exists (select 1 from vehicle_units u where u.product_id = di.product_id)
       and (select count(*) from document_item_vehicles v where v.document_item_id = di.id and v.removed_at is null) < di.quantity;
    if v_missing is not null then
      raise exception 'Choisissez d''abord le numéro de châssis des véhicules de la commande (%).', split_part(v_missing, E'\n', 1);
    end if;
  end if;

  v_number := get_next_document_number(v_src.organization_id, p_target::document_type, extract(year from current_date)::int);

  perform set_config('app.doc_guard_bypass', 'on', true);

  insert into documents (organization_id, document_type, document_number, status, client_id, commercial_id,
                         parent_document_id, issue_date, due_date, subtotal, discount_amount, tax_amount, total_amount, notes)
  values (v_src.organization_id, p_target::document_type, v_number, 'brouillon', v_src.client_id, v_src.commercial_id,
          v_src.id, current_date, (current_date + interval '1 month')::date, v_src.subtotal, v_src.discount_amount,
          v_src.tax_amount, v_src.total_amount, v_src.notes)
  returning id into v_new;

  insert into document_items (document_id, product_id, designation, quantity, unit_price, tax_rate, discount_percent, position)
  select v_new, product_id, designation, quantity, unit_price, tax_rate, discount_percent, position
    from document_items where document_id = v_src.id order by position;

  -- Les châssis choisis sur la commande passent sur la facture (même position de ligne).
  insert into document_item_vehicles (document_id, document_item_id, vehicle_unit_id)
  select v_new, ni.id, v.vehicle_unit_id
    from document_item_vehicles v
    join document_items si on si.id = v.document_item_id
    join document_items ni on ni.document_id = v_new and ni.position = si.position
   where v.document_id = v_src.id and v.removed_at is null;

  update documents set status = 'accepte', updated_at = now()
   where id = v_src.id and status::text not in ('paye', 'paye_partiel');

  perform set_config('app.doc_guard_bypass', 'off', true);

  if p_target = 'facture' then
    perform apply_facture_stock(v_new);
  else
    for v_user in
      select id from profiles where organization_id = v_src.organization_id and role::text = 'admin_ventes' and is_active
    loop
      insert into notifications (organization_id, user_id, type, title, message, related_document_id)
      values (v_src.organization_id, v_user.id, 'commande_a_facturer', 'Commande à facturer',
              format('La commande %s attend sa facture.', v_number), v_new);
    end loop;
  end if;

  return v_new;
end;
$$;
revoke all on function public.convert_document(uuid, text) from public, anon;
grant execute on function public.convert_document(uuid, text) to authenticated;

revoke all on function public.vehicle_units_guard() from public, anon, authenticated;
revoke all on function public.sync_product_quantity_from_units() from public, anon, authenticated;
revoke all on function public.release_vehicle_unit_link() from public, anon, authenticated;
revoke all on function public.vehicle_units_on_payment() from public, anon, authenticated;
revoke all on function public.vehicle_unit_active_document(uuid) from public, anon;
grant execute on function public.vehicle_unit_active_document(uuid) to authenticated;

-- (table déjà créée lors de l'installation : clé étrangère remplacée)
alter table vehicle_units drop constraint if exists vehicle_units_sold_document_id_fkey;
alter table vehicle_units add constraint vehicle_units_sold_document_id_fkey
  foreign key (sold_document_id) references documents(id) on delete set null;
