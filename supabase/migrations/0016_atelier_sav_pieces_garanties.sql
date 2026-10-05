-- ============================================================================
-- PHASE 2 DU CAHIER DES CHARGES — Atelier/SAV (Module 3), Magasin de pièces
-- détachées (Module 4), Garanties constructeur (Module 13).
--
-- Écrit de façon idempotente (drop/if not exists partout où c'est possible)
-- car l'expérience des migrations 0006/0008 a montré qu'une migration peut
-- être rejouée ou avoir été sautée par erreur sur le projet Supabase réel.
-- Note : Postgres n'a pas "create type if not exists", d'où les blocs
-- do $$ ... $$ qui vérifient pg_type avant de créer chaque enum.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Nouveaux rôles métier (atelier/magasin), en plus des rôles existants.
-- ----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_enum where enumlabel = 'receptionniste_sav' and enumtypid = 'user_role'::regtype) then
    alter type user_role add value 'receptionniste_sav';
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_enum where enumlabel = 'chef_atelier' and enumtypid = 'user_role'::regtype) then
    alter type user_role add value 'chef_atelier';
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_enum where enumlabel = 'technicien' and enumtypid = 'user_role'::regtype) then
    alter type user_role add value 'technicien';
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_enum where enumlabel = 'magasinier' and enumtypid = 'user_role'::regtype) then
    alter type user_role add value 'magasinier';
  end if;
end $$;

-- Important : Postgres interdit d'utiliser une valeur d'enum fraîchement
-- ajoutée (ALTER TYPE ... ADD VALUE) dans la MÊME transaction/script — et
-- l'éditeur SQL de Supabase exécute tout le fichier collé comme un seul
-- bloc. Toutes les policies plus bas comparent donc auth_role()::text
-- (texte) au lieu de auth_role() (enum) pour éviter l'erreur "unsafe use
-- of new value of enum type" quand ce fichier est exécuté en une fois.

-- ============================================================================
-- 1. MAGASIN DE PIÈCES DÉTACHÉES (Module 4)
-- ============================================================================
create table if not exists parts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  reference         text not null,
  designation       text not null,
  brand             text,
  compatible_models text,
  supplier_name     text,
  location          text,                               -- emplacement magasin
  purchase_price    numeric(14,2) default 0,
  sale_price        numeric(14,2) not null default 0,
  tax_rate          numeric(5,2) default 18.00,
  quantity_on_hand  numeric(12,2) default 0,
  quantity_reserved numeric(12,2) default 0,
  stock_min         numeric(12,2) default 0,
  stock_max         numeric(12,2),
  is_active         boolean default true,
  is_archived       boolean default false,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  unique (organization_id, reference)
);

create index if not exists idx_parts_org on parts(organization_id);
create index if not exists idx_parts_active on parts(organization_id, is_active) where is_active = true;
create index if not exists idx_parts_search on parts using gin (
  to_tsvector('french', coalesce(reference,'') || ' ' || coalesce(designation,'') || ' ' || coalesce(brand,''))
);

do $$ begin
  if not exists (select 1 from pg_type where typname = 'parts_movement_type') then
    create type parts_movement_type as enum ('entree', 'sortie', 'ajustement', 'inventaire', 'reservation', 'liberation');
  end if;
end $$;

create table if not exists parts_stock_movements (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  part_id           uuid not null references parts(id),
  movement_type     parts_movement_type not null,
  quantity          numeric(12,2) not null,
  reason            text,
  repair_order_id   uuid,                                -- renseigné si lié à un OR (voir section 2)
  performed_by      uuid references profiles(id),
  created_at        timestamptz default now()
);

create index if not exists idx_parts_moves_part on parts_stock_movements(part_id);
create index if not exists idx_parts_moves_org on parts_stock_movements(organization_id, created_at desc);

-- ============================================================================
-- 2. ATELIER / SAV (Module 3)
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'appointment_status') then
    create type appointment_status as enum ('planifie', 'confirme', 'realise', 'annule');
  end if;
end $$;

create table if not exists workshop_appointments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  client_id         uuid references clients(id),
  vehicle_vin       text,
  vehicle_plate     text,
  vehicle_label     text,                                -- ex: "Tiggo 7 - gris"
  scheduled_at      timestamptz not null,
  reason            text,
  status            appointment_status not null default 'planifie',
  notes             text,
  created_by        uuid references profiles(id),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists idx_appointments_org on workshop_appointments(organization_id, scheduled_at);
create index if not exists idx_appointments_client on workshop_appointments(client_id);

do $$ begin
  if not exists (select 1 from pg_type where typname = 'repair_order_status') then
    create type repair_order_status as enum ('ouvert', 'en_cours', 'en_attente_pieces', 'termine', 'facture', 'annule');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'quote_status') then
    create type quote_status as enum ('en_attente', 'valide', 'refuse');
  end if;
end $$;

-- Compteur dédié (même principe que get_next_document_number / get_next_contract_number)
create table if not exists repair_order_counters (
  organization_id uuid not null references organizations(id),
  year            int not null,
  last_number     int not null default 0,
  primary key (organization_id, year)
);

create table if not exists repair_orders (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations(id),
  order_number          text,
  appointment_id        uuid references workshop_appointments(id) on delete set null,
  client_id             uuid references clients(id),
  vehicle_vin           text,
  vehicle_plate         text,
  vehicle_label         text,
  vehicle_mileage_in    numeric(10,0),
  receptionist_id       uuid references profiles(id),
  technician_id         uuid references profiles(id),
  diagnostic            text,
  labor_hours_planned   numeric(6,2) default 0,
  labor_hours_actual    numeric(6,2) default 0,
  labor_rate            numeric(12,2) default 0,         -- taux horaire FCFA
  status                repair_order_status not null default 'ouvert',
  quote_status          quote_status default 'en_attente',
  quote_total           numeric(14,2) default 0,
  quote_validated_at    timestamptz,
  warranty_covered      boolean default false,
  warranty_claim_id     uuid,                             -- renseigné si pris en charge (voir section 3)
  document_id           uuid references documents(id) on delete set null,
  opened_at             timestamptz default now(),
  closed_at             timestamptz,
  notes                 text,
  created_by            uuid references profiles(id),
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create index if not exists idx_repair_orders_org on repair_orders(organization_id, created_at desc);
create index if not exists idx_repair_orders_status on repair_orders(organization_id, status);
create index if not exists idx_repair_orders_client on repair_orders(client_id);
create index if not exists idx_repair_orders_technician on repair_orders(technician_id);

create or replace function get_next_repair_order_number(p_organization_id uuid, p_year int)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_next int;
begin
  if p_organization_id != auth_org_id() then
    raise exception 'Organisation non autorisée';
  end if;

  insert into repair_order_counters (organization_id, year, last_number)
  values (p_organization_id, p_year, 1)
  on conflict (organization_id, year)
  do update set last_number = repair_order_counters.last_number + 1
  returning last_number into v_next;

  return 'OR-' || p_year || '-' || lpad(v_next::text, 6, '0');
end;
$$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'repair_order_item_type') then
    create type repair_order_item_type as enum ('main_oeuvre', 'piece');
  end if;
end $$;

create table if not exists repair_order_items (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  repair_order_id   uuid not null references repair_orders(id) on delete cascade,
  item_type         repair_order_item_type not null,
  part_id           uuid references parts(id),            -- renseigné si item_type = 'piece'
  designation       text not null,
  quantity          numeric(10,2) not null default 1,
  unit_price        numeric(14,2) not null default 0,
  position          int default 0,
  created_at        timestamptz default now()
);

create index if not exists idx_or_items_order on repair_order_items(repair_order_id);

-- ============================================================================
-- 3. GARANTIES CONSTRUCTEUR (Module 13)
-- ============================================================================
create table if not exists vehicle_warranties (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  client_id         uuid references clients(id),
  product_id        uuid references products(id),        -- modèle vendu (catalogue)
  sale_contract_id  uuid references sale_contracts(id) on delete set null,
  vehicle_vin       text not null,
  brand             text,
  model             text,
  start_date        date not null default current_date,  -- 1ère mise en circulation / livraison
  duration_months   int not null default 36,
  mileage_limit     numeric(10,0) default 100000,
  covered_parts     text,
  notes             text,
  created_by        uuid references profiles(id),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists idx_warranties_org on vehicle_warranties(organization_id);
create index if not exists idx_warranties_vin on vehicle_warranties(organization_id, vehicle_vin);
create index if not exists idx_warranties_client on vehicle_warranties(client_id);

do $$ begin
  if not exists (select 1 from pg_type where typname = 'warranty_claim_status') then
    create type warranty_claim_status as enum ('soumise', 'acceptee', 'refusee', 'remboursee');
  end if;
end $$;

create table if not exists warranty_claims (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  warranty_id       uuid not null references vehicle_warranties(id),
  repair_order_id   uuid references repair_orders(id) on delete set null,
  description       text,
  amount_requested  numeric(14,2) default 0,
  amount_covered    numeric(14,2) default 0,
  status            warranty_claim_status not null default 'soumise',
  submitted_at      timestamptz default now(),
  decided_at        timestamptz,
  notes             text,
  created_by        uuid references profiles(id),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists idx_claims_org on warranty_claims(organization_id);
create index if not exists idx_claims_warranty on warranty_claims(warranty_id);
create index if not exists idx_claims_repair_order on warranty_claims(repair_order_id);

-- Le lien "ordre de réparation -> dossier de garantie en cours" ne peut être
-- ajouté qu'une fois warranty_claims créée (référence croisée) ; ajouté ici
-- en toute fin, idempotent via un bloc do/exception.
do $$ begin
  alter table repair_orders
    add constraint repair_orders_warranty_claim_fk
    foreign key (warranty_claim_id) references warranty_claims(id) on delete set null;
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================================
alter table parts enable row level security;
alter table parts_stock_movements enable row level security;
alter table workshop_appointments enable row level security;
alter table repair_orders enable row level security;
alter table repair_order_items enable row level security;
alter table vehicle_warranties enable row level security;
alter table warranty_claims enable row level security;

-- ---------- Pièces : lecture large dans l'org, écriture magasinier + gestion ----------
drop policy if exists parts_select on parts;
create policy parts_select on parts for select using (organization_id = auth_org_id());

drop policy if exists parts_write on parts;
create policy parts_write on parts for all using (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','magasinier','chef_atelier')
) with check (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','magasinier','chef_atelier')
);

drop policy if exists parts_moves_select on parts_stock_movements;
create policy parts_moves_select on parts_stock_movements for select using (organization_id = auth_org_id());

drop policy if exists parts_moves_insert on parts_stock_movements;
create policy parts_moves_insert on parts_stock_movements for insert with check (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','magasinier','chef_atelier')
);

-- ---------- Rendez-vous atelier : accueil/commercial peuvent créer ----------
drop policy if exists appointments_select on workshop_appointments;
create policy appointments_select on workshop_appointments for select using (organization_id = auth_org_id());

drop policy if exists appointments_write on workshop_appointments;
create policy appointments_write on workshop_appointments for all using (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','commercial','receptionniste_sav','chef_atelier')
) with check (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','commercial','receptionniste_sav','chef_atelier')
);

-- ---------- Ordres de réparation : lecture large (y compris comptable pour facturation) ----------
drop policy if exists repair_orders_select on repair_orders;
create policy repair_orders_select on repair_orders for select using (organization_id = auth_org_id());

drop policy if exists repair_orders_insert on repair_orders;
create policy repair_orders_insert on repair_orders for insert with check (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','receptionniste_sav','chef_atelier')
);

drop policy if exists repair_orders_update on repair_orders;
create policy repair_orders_update on repair_orders for update using (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','receptionniste_sav','chef_atelier','technicien','comptable')
);

drop policy if exists repair_orders_delete on repair_orders;
create policy repair_orders_delete on repair_orders for delete using (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager')
);

drop policy if exists or_items_select on repair_order_items;
create policy or_items_select on repair_order_items for select using (organization_id = auth_org_id());

drop policy if exists or_items_write on repair_order_items;
create policy or_items_write on repair_order_items for all using (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','receptionniste_sav','chef_atelier','technicien')
) with check (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','receptionniste_sav','chef_atelier','technicien')
);

-- ---------- Garanties constructeur ----------
drop policy if exists warranties_select on vehicle_warranties;
create policy warranties_select on vehicle_warranties for select using (organization_id = auth_org_id());

drop policy if exists warranties_write on vehicle_warranties;
create policy warranties_write on vehicle_warranties for all using (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','receptionniste_sav','chef_atelier','comptable')
) with check (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','receptionniste_sav','chef_atelier','comptable')
);

drop policy if exists claims_select on warranty_claims;
create policy claims_select on warranty_claims for select using (organization_id = auth_org_id());

drop policy if exists claims_write on warranty_claims;
create policy claims_write on warranty_claims for all using (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','chef_atelier','comptable')
) with check (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin','administrateur','manager','chef_atelier','comptable')
);

alter table repair_order_counters enable row level security;
drop policy if exists or_counters_none on repair_order_counters;
-- aucune policy "select/insert/update" directe : uniquement manipulé par la
-- fonction security definer get_next_repair_order_number(), même logique
-- que document_number_counters / sale_contract_counters.
