-- ============================================================================
-- KF AUTO ERP — SCHÉMA POSTGRESQL COMPLET (Supabase)
-- Phase 2 : Base de données
-- ============================================================================
-- Conventions :
--   - Toutes les tables métier portent organization_id (architecture SaaS-ready)
--   - UUID générés côté client acceptés (offline-first) : id = uuid, pas serial
--   - Numérotation officielle (PF-2026-000001...) assignée par fonction atomique
--     côté serveur, jamais générée côté client -> zéro doublon même hors ligne
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ============================================================================
-- 1. ORGANISATIONS (multi-tenant, même si une seule org au départ)
-- ============================================================================
create table organizations (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  legal_name        text,
  rccm              text,
  nif               text,
  ifu               text,
  address           text,
  city              text,
  country           text default 'Togo',
  phone             text,
  email             text,
  logo_url          text,
  currency          text default 'FCFA',
  default_language  text default 'fr',
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- ============================================================================
-- 2. UTILISATEURS & RÔLES
-- ============================================================================
create type user_role as enum (
  'super_admin', 'administrateur', 'manager', 'comptable', 'commercial'
);

-- Étend auth.users (Supabase Auth)
create table profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  organization_id     uuid not null references organizations(id),
  role                user_role not null default 'commercial',
  full_name           text not null,
  phone               text,
  email               text,
  avatar_url          text,
  is_active           boolean default true,
  two_factor_enabled  boolean default false,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index idx_profiles_org on profiles(organization_id);
create index idx_profiles_role on profiles(organization_id, role);

-- ============================================================================
-- 3. CLIENTS
-- ============================================================================
create table clients (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  assigned_to       uuid references profiles(id),      -- commercial "propriétaire"
  client_type       text check (client_type in ('particulier','entreprise')) default 'particulier',
  first_name        text,
  last_name         text,
  company_name      text,
  phone             text,
  whatsapp          text,
  email             text,
  address           text,
  city              text,
  country           text default 'Togo',
  rccm              text,
  nif               text,
  ifu               text,
  tax_number        text,
  main_contact_name text,
  notes             text,
  is_archived       boolean default false,
  created_by        uuid references profiles(id),
  created_offline   boolean default false,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index idx_clients_org on clients(organization_id);
create index idx_clients_assigned on clients(assigned_to);
create index idx_clients_search on clients using gin (
  to_tsvector('french', coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(company_name,''))
);

create table client_attachments (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  file_url    text not null,
  file_name   text,
  uploaded_by uuid references profiles(id),
  created_at  timestamptz default now()
);

-- ============================================================================
-- 4. PRODUITS & SERVICES
-- ============================================================================
create table product_categories (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  name              text not null,
  parent_id         uuid references product_categories(id)
);

create table products (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  category_id       uuid references product_categories(id),
  reference         text,
  sku               text,
  designation       text not null,
  brand             text,
  model             text,
  description       text,
  purchase_price    numeric(14,2) default 0,
  sale_price        numeric(14,2) not null default 0,
  tax_rate          numeric(5,2) default 18.00,          -- TVA 18% par défaut (Togo)
  quantity_on_hand  numeric(12,2) default 0,
  stock_min         numeric(12,2) default 0,
  photo_url         text,
  is_active         boolean default true,
  is_archived       boolean default false,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  unique (organization_id, sku)
);

create index idx_products_org on products(organization_id);
create index idx_products_active on products(organization_id, is_active) where is_active = true;

-- ============================================================================
-- 5. STOCK
-- ============================================================================
create type stock_movement_type as enum ('entree','sortie','ajustement','inventaire');

create table stock_movements (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations(id),
  product_id            uuid not null references products(id),
  movement_type         stock_movement_type not null,
  quantity              numeric(12,2) not null,          -- positif ou négatif selon le type
  reason                text,
  reference_document_id uuid,                            -- lien vers un bon de livraison par ex.
  performed_by          uuid references profiles(id),
  created_at            timestamptz default now()
);

create index idx_stock_moves_product on stock_movements(product_id);
create index idx_stock_moves_org on stock_movements(organization_id, created_at desc);

-- ============================================================================
-- 6. DOCUMENTS COMMERCIAUX
-- ============================================================================
create type document_type as enum (
  'proforma','devis','facture','bon_livraison','recu','avoir'
);

create type document_status as enum (
  'brouillon','envoye','accepte','refuse','paye_partiel','paye','annule'
);

-- Compteurs de numérotation : 1 ligne par (organisation, type, année)
-- -> l'incrémentation atomique garantit ZÉRO doublon même avec des syncs concurrentes
create table document_number_counters (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  document_type     document_type not null,
  year              int not null,
  last_number       int not null default 0,
  unique (organization_id, document_type, year)
);

-- Fonction atomique d'attribution du numéro officiel (appelée UNIQUEMENT côté serveur,
-- au moment de la synchronisation d'un document créé offline, ou à sa création online)
create or replace function get_next_document_number(
  p_organization_id uuid,
  p_document_type   document_type,
  p_year            int
) returns text
language plpgsql
as $$
declare
  v_prefix text;
  v_next   int;
begin
  v_prefix := case p_document_type
    when 'proforma'      then 'PF'
    when 'devis'          then 'DEV'
    when 'facture'        then 'FAC'
    when 'bon_livraison'  then 'BL'
    when 'recu'           then 'REC'
    when 'avoir'          then 'AV'
  end;

  insert into document_number_counters (organization_id, document_type, year, last_number)
  values (p_organization_id, p_document_type, p_year, 1)
  on conflict (organization_id, document_type, year)
  do update set last_number = document_number_counters.last_number + 1
  returning last_number into v_next;

  return v_prefix || '-' || p_year || '-' || lpad(v_next::text, 6, '0');
end;
$$;

create table documents (
  id                      uuid primary key default gen_random_uuid(), -- généré côté client OK (offline)
  organization_id         uuid not null references organizations(id),
  document_type           document_type not null,
  document_number         text unique,                    -- NULL tant que non synchronisé/assigné
  status                  document_status not null default 'brouillon',
  client_id               uuid not null references clients(id),
  commercial_id           uuid not null references profiles(id),
  parent_document_id      uuid references documents(id),  -- ex : devis -> facture générée
  issue_date              date default current_date,
  due_date                date,
  subtotal                numeric(14,2) default 0,
  discount_amount         numeric(14,2) default 0,
  tax_amount              numeric(14,2) default 0,
  total_amount            numeric(14,2) default 0,
  amount_paid             numeric(14,2) default 0,
  balance_due             numeric(14,2) generated always as (total_amount - amount_paid) stored,
  currency                text default 'FCFA',
  notes                   text,
  commercial_signature_url text,
  client_signature_url    text,
  signed_at               timestamptz,
  pdf_url                 text,
  qr_code_data            text,
  created_offline         boolean default false,
  synced_at               timestamptz,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

create index idx_documents_org on documents(organization_id);
create index idx_documents_commercial on documents(commercial_id);
create index idx_documents_client on documents(client_id);
create index idx_documents_type_status on documents(organization_id, document_type, status);
create index idx_documents_number on documents(document_number);

create table document_items (
  id                uuid primary key default gen_random_uuid(),
  document_id       uuid not null references documents(id) on delete cascade,
  product_id        uuid references products(id),
  designation       text not null,
  quantity          numeric(12,2) not null default 1,
  unit_price        numeric(14,2) not null default 0,
  tax_rate          numeric(5,2) default 18.00,
  discount_percent  numeric(5,2) default 0,
  line_total        numeric(14,2) generated always as (
    quantity * unit_price * (1 - discount_percent/100.0) * (1 + tax_rate/100.0)
  ) stored,
  position          int default 0
);

create index idx_document_items_doc on document_items(document_id);

create type send_channel as enum ('email','whatsapp','sms');
create type send_status as enum ('en_attente','envoye','echec');

create table document_sendings (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references documents(id) on delete cascade,
  channel        send_channel not null,
  recipient      text not null,
  status         send_status not null default 'en_attente',
  sent_at        timestamptz,
  error_message  text,
  sent_by        uuid references profiles(id),
  created_at     timestamptz default now()
);

-- ============================================================================
-- 7. PAIEMENTS
-- ============================================================================
create type payment_method as enum (
  'especes','virement','cheque','mobile_money_flooz','mobile_money_tmoney','autre'
);

create table payments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  document_id       uuid not null references documents(id),
  client_id         uuid not null references clients(id),
  amount            numeric(14,2) not null check (amount > 0),
  payment_method    payment_method not null,
  payment_date      date default current_date,
  reference         text,
  recorded_by       uuid references profiles(id),
  notes             text,
  created_at        timestamptz default now()
);

create index idx_payments_document on payments(document_id);
create index idx_payments_client on payments(client_id);

-- Trigger : met à jour amount_paid et status du document à chaque paiement
create or replace function apply_payment_to_document() returns trigger
language plpgsql as $$
begin
  update documents
  set amount_paid = amount_paid + new.amount,
      status = case
        when amount_paid + new.amount >= total_amount then 'paye'::document_status
        else 'paye_partiel'::document_status
      end,
      updated_at = now()
  where id = new.document_id;
  return new;
end;
$$;

create trigger trg_apply_payment
after insert on payments
for each row execute function apply_payment_to_document();

-- ============================================================================
-- 8. NOTIFICATIONS
-- ============================================================================
create table notifications (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations(id),
  user_id               uuid not null references profiles(id),
  type                  text not null,        -- 'facture_creee','paiement_recu','rupture_stock', ...
  title                 text not null,
  message               text,
  is_read               boolean default false,
  related_document_id   uuid references documents(id),
  created_at            timestamptz default now()
);

create index idx_notifications_user on notifications(user_id, is_read);

-- ============================================================================
-- 9. AUDIT
-- ============================================================================
create type audit_action as enum ('insert','update','delete','login');

create table audit_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id),
  user_id         uuid references profiles(id),
  table_name      text not null,
  record_id       uuid,
  action          audit_action not null,
  old_data        jsonb,
  new_data        jsonb,
  ip_address      text,
  created_at      timestamptz default now()
);

create index idx_audit_org on audit_log(organization_id, created_at desc);

-- Exemple générique de trigger d'audit (à répliquer sur documents, clients, payments, products)
create or replace function audit_trigger_fn() returns trigger
language plpgsql as $$
begin
  insert into audit_log(organization_id, user_id, table_name, record_id, action, old_data, new_data)
  values (
    coalesce(new.organization_id, old.organization_id),
    auth.uid(),
    tg_table_name,
    coalesce(new.id, old.id),
    lower(tg_op)::audit_action,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

create trigger trg_audit_documents
after insert or update or delete on documents
for each row execute function audit_trigger_fn();

create trigger trg_audit_clients
after insert or update or delete on clients
for each row execute function audit_trigger_fn();

create trigger trg_audit_payments
after insert or update or delete on payments
for each row execute function audit_trigger_fn();

-- ============================================================================
-- 10. ROW LEVEL SECURITY (RLS) — cloisonnement strict par rôle/commercial
-- ============================================================================

-- Fonctions utilitaires : lisent le profil de l'utilisateur connecté
create or replace function auth_role() returns user_role
language sql stable as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function auth_org_id() returns uuid
language sql stable as $$
  select organization_id from profiles where id = auth.uid();
$$;

alter table clients enable row level security;
alter table documents enable row level security;
alter table payments enable row level security;
alter table products enable row level security;
alter table stock_movements enable row level security;

-- CLIENTS : super_admin/administrateur/manager/comptable voient toute l'org,
-- un commercial ne voit QUE ses propres clients
create policy clients_select on clients for select using (
  organization_id = auth_org_id() and (
    auth_role() in ('super_admin','administrateur','manager','comptable')
    or assigned_to = auth.uid()
  )
);

create policy clients_insert on clients for insert with check (
  organization_id = auth_org_id()
);

create policy clients_update on clients for update using (
  organization_id = auth_org_id() and (
    auth_role() in ('super_admin','administrateur')
    or assigned_to = auth.uid()
  )
);

-- DOCUMENTS : même logique, filtrée sur commercial_id
create policy documents_select on documents for select using (
  organization_id = auth_org_id() and (
    auth_role() in ('super_admin','administrateur','manager','comptable')
    or commercial_id = auth.uid()
  )
);

create policy documents_insert on documents for insert with check (
  organization_id = auth_org_id() and commercial_id = auth.uid()
);

create policy documents_update on documents for update using (
  organization_id = auth_org_id() and (
    auth_role() in ('super_admin','administrateur')
    or commercial_id = auth.uid()
  )
);

-- PRODUITS / STOCK : lecture ouverte à toute l'organisation (catalogue partagé),
-- écriture réservée aux rôles habilités
create policy products_select on products for select using (
  organization_id = auth_org_id()
);

create policy products_write on products for all using (
  organization_id = auth_org_id() and auth_role() in ('super_admin','administrateur')
);

create policy stock_select on stock_movements for select using (
  organization_id = auth_org_id()
);

-- PAIEMENTS : comptable + admin + super_admin, et le commercial concerné en lecture seule
create policy payments_select on payments for select using (
  organization_id = auth_org_id() and (
    auth_role() in ('super_admin','administrateur','comptable','manager')
    or exists (select 1 from documents d where d.id = payments.document_id and d.commercial_id = auth.uid())
  )
);

create policy payments_write on payments for insert with check (
  organization_id = auth_org_id() and auth_role() in ('super_admin','administrateur','comptable')
);

-- Note : des policies équivalentes doivent être répliquées sur toutes les tables
-- restantes (notifications, document_items, document_sendings, client_attachments)
-- en héritant du organization_id/commercial_id du document ou client parent.
