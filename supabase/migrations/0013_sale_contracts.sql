-- Contrats de vente de véhicules : génération automatique du contrat
-- (numéro officiel, comme les devis/factures) + signature électronique en
-- deux étapes (commercial puis client), en réutilisant exactement le même
-- mécanisme que la signature des documents (canvas -> PNG -> bucket
-- "document-signatures" -> URL stockée sur la ligne).

create type sale_contract_status as enum ('brouillon', 'signe', 'annule');

create table sale_contracts (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references organizations(id),
  contract_number         text,
  client_id               uuid not null references clients(id),
  product_id              uuid not null references products(id),
  commercial_id           uuid not null references profiles(id),
  document_id             uuid references documents(id) on delete set null,
  sale_price              numeric(14,2) not null default 0,
  payment_terms           text,
  notes                   text,
  status                  sale_contract_status not null default 'brouillon',
  commercial_signature_url text,
  client_signature_url    text,
  signed_at               timestamptz,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

create index idx_sale_contracts_org on sale_contracts(organization_id);
create index idx_sale_contracts_client on sale_contracts(client_id);
create index idx_sale_contracts_product on sale_contracts(product_id);

-- Numérotation officielle, même principe que get_next_document_number
-- (0001_init.sql / 0006_rls_gaps.sql) mais dans sa propre table de compteurs
-- : un contrat n'est pas un type de `documents.document_type`, inutile de
-- modifier cet enum existant pour ça.
create table sale_contract_counters (
  organization_id uuid not null references organizations(id),
  year            int not null,
  last_number     int not null default 0,
  primary key (organization_id, year)
);

create or replace function get_next_contract_number(p_organization_id uuid, p_year int)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_next int;
begin
  if p_organization_id != auth_org_id() then
    raise exception 'Organisation non autorisée';
  end if;

  insert into sale_contract_counters (organization_id, year, last_number)
  values (p_organization_id, p_year, 1)
  on conflict (organization_id, year)
  do update set last_number = sale_contract_counters.last_number + 1
  returning last_number into v_next;

  return 'CV-' || p_year || '-' || lpad(v_next::text, 6, '0');
end;
$$;

alter table sale_contracts enable row level security;
alter table sale_contract_counters enable row level security;

-- Même périmètre que documents_select/insert/update : lecture élargie aux
-- rôles de gestion, écriture au commercial propriétaire.
create policy sale_contracts_select on sale_contracts for select using (
  organization_id = auth_org_id() and (
    auth_role() in ('super_admin','administrateur','manager','comptable')
    or commercial_id = auth.uid()
  )
);

create policy sale_contracts_insert on sale_contracts for insert with check (
  organization_id = auth_org_id() and commercial_id = auth.uid()
);

create policy sale_contracts_update on sale_contracts for update using (
  organization_id = auth_org_id() and (
    auth_role() in ('super_admin','administrateur')
    or commercial_id = auth.uid()
  )
);

create policy sale_contract_counters_select on sale_contract_counters for select using (
  organization_id = auth_org_id()
);
