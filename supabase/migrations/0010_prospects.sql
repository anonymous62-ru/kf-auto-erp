-- Module "Gestion des prospects" : suivi des personnes intéressées avant
-- qu'elles ne deviennent des clients (fiche prospect, relances, rendez-vous,
-- conversion en client). Suit le même schéma de cloisonnement (RLS par
-- organisation + rôle/commercial) que clients/documents dans 0001_init.sql.

create type prospect_status as enum (
  'nouveau', 'contacte', 'interesse', 'rdv_planifie', 'negociation', 'converti', 'perdu'
);

create type prospect_source as enum (
  'showroom', 'appel', 'whatsapp', 'site_web', 'reseaux_sociaux', 'recommandation', 'autre'
);

create table prospects (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id),
  assigned_to         uuid references profiles(id),        -- commercial "propriétaire"
  first_name          text,
  last_name           text,
  phone               text,
  whatsapp            text,
  email               text,
  source              prospect_source default 'autre',
  status              prospect_status not null default 'nouveau',
  vehicle_interest_id uuid references products(id),         -- véhicule du catalogue qui intéresse le prospect
  vehicle_interest    text,                                  -- libellé libre si hors catalogue / pas encore précisé
  notes               text,
  next_relance_at     timestamptz,                           -- date de prochaine relance à faire
  last_contact_at     timestamptz,
  client_id           uuid references clients(id),           -- renseigné lors de la conversion en client
  created_by          uuid references profiles(id),
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index idx_prospects_org on prospects(organization_id);
create index idx_prospects_assigned on prospects(assigned_to);
create index idx_prospects_status on prospects(organization_id, status);
create index idx_prospects_relance on prospects(organization_id, next_relance_at) where status not in ('converti', 'perdu');

-- Historique des relances/contacts (appels, WhatsApp, visites...)
create type prospect_activity_type as enum ('relance', 'appel', 'whatsapp', 'email', 'visite', 'autre');

create table prospect_activities (
  id             uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  prospect_id    uuid not null references prospects(id) on delete cascade,
  activity_type  prospect_activity_type not null default 'relance',
  notes          text,
  performed_by   uuid references profiles(id),
  created_at     timestamptz default now()
);

create index idx_prospect_activities_prospect on prospect_activities(prospect_id, created_at desc);

-- Rendez-vous planifiés avec un prospect
create type appointment_status as enum ('planifie', 'confirme', 'realise', 'annule', 'absent');

create table prospect_appointments (
  id             uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  prospect_id    uuid not null references prospects(id) on delete cascade,
  scheduled_at   timestamptz not null,
  location       text,
  notes          text,
  status         appointment_status not null default 'planifie',
  created_by     uuid references profiles(id),
  created_at     timestamptz default now()
);

create index idx_prospect_appointments_prospect on prospect_appointments(prospect_id, scheduled_at);
create index idx_prospect_appointments_upcoming on prospect_appointments(organization_id, scheduled_at)
  where status in ('planifie', 'confirme');

-- ============================================================================
-- RLS — même logique que documents/clients : le commercial ne voit/modifie
-- que ses propres prospects, les rôles admin+ voient tout l'organisation.
-- ============================================================================

alter table prospects enable row level security;
alter table prospect_activities enable row level security;
alter table prospect_appointments enable row level security;

create policy prospects_select on prospects for select using (
  organization_id = auth_org_id() and (
    auth_role() in ('super_admin', 'administrateur', 'manager', 'comptable')
    or assigned_to = auth.uid()
  )
);

create policy prospects_insert on prospects for insert with check (
  organization_id = auth_org_id() and (
    auth_role() in ('super_admin', 'administrateur', 'manager')
    or assigned_to = auth.uid()
  )
);

create policy prospects_update on prospects for update using (
  organization_id = auth_org_id() and (
    auth_role() in ('super_admin', 'administrateur', 'manager')
    or assigned_to = auth.uid()
  )
);

create policy prospects_delete on prospects for delete using (
  organization_id = auth_org_id() and auth_role() in ('super_admin', 'administrateur')
);

create policy prospect_activities_select on prospect_activities for select using (
  exists (
    select 1 from prospects p
    where p.id = prospect_activities.prospect_id
      and p.organization_id = auth_org_id()
      and (auth_role() in ('super_admin', 'administrateur', 'manager', 'comptable') or p.assigned_to = auth.uid())
  )
);

create policy prospect_activities_insert on prospect_activities for insert with check (
  exists (
    select 1 from prospects p
    where p.id = prospect_activities.prospect_id
      and p.organization_id = auth_org_id()
      and (auth_role() in ('super_admin', 'administrateur', 'manager') or p.assigned_to = auth.uid())
  )
);

create policy prospect_appointments_select on prospect_appointments for select using (
  exists (
    select 1 from prospects p
    where p.id = prospect_appointments.prospect_id
      and p.organization_id = auth_org_id()
      and (auth_role() in ('super_admin', 'administrateur', 'manager', 'comptable') or p.assigned_to = auth.uid())
  )
);

create policy prospect_appointments_write on prospect_appointments for all using (
  exists (
    select 1 from prospects p
    where p.id = prospect_appointments.prospect_id
      and p.organization_id = auth_org_id()
      and (auth_role() in ('super_admin', 'administrateur', 'manager') or p.assigned_to = auth.uid())
  )
);
