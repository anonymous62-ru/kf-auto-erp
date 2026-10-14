-- Retours de la direction du 09/10/2026, étape 3 : outils commerciaux.
--
--  - AFFAIRES (deals) : opportunités de vente avec leur température
--    (chaude / tiède / froide) et leur étape. Une affaire part d'un lead ou
--    d'un contact, suit sa facture proforma, passe "commande" à la
--    conversion et "gagnée" au premier versement sur la facture.
--  - AGENDA : rendez-vous, relances, essais, livraisons de chaque commercial.
--    La direction (et les chefs de service) consultent l'agenda de tous.
--    Les rendez-vous et relances déjà saisis sur les leads y apparaissent.

-- ---------------------------------------------------------------------------
-- Affaires
-- ---------------------------------------------------------------------------
create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  assigned_to uuid not null references profiles(id),
  created_by uuid references profiles(id),
  title text not null,
  lead_id uuid references prospects(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  product_id uuid references products(id) on delete set null,
  quantity integer not null default 1 check (quantity > 0),
  estimated_amount numeric not null default 0 check (estimated_amount >= 0),
  temperature text not null default 'tiede' check (temperature in ('chaude', 'tiede', 'froide')),
  stage text not null default 'decouverte'
    check (stage in ('decouverte', 'proforma', 'negociation', 'commande', 'gagnee', 'perdue')),
  expected_close_date date,
  document_id uuid references documents(id) on delete set null,
  lost_reason text,
  notes text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deals_org_stage_idx on deals (organization_id, stage, temperature);
create index if not exists deals_assigned_idx on deals (assigned_to);
create index if not exists deals_document_idx on deals (document_id);
create index if not exists deals_lead_idx on deals (lead_id);
alter table deals enable row level security;

do $$ begin
  create policy deals_select on deals for select using (
    organization_id = auth_org_id()
    and (assigned_to = auth.uid()
         or auth_role()::text in ('super_admin', 'administrateur', 'manager', 'admin_ventes', 'chef_service')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy deals_insert on deals for insert with check (
    organization_id = auth_org_id()
    and (assigned_to = auth.uid() or auth_role()::text in ('super_admin', 'administrateur', 'manager')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy deals_update on deals for update using (
    organization_id = auth_org_id()
    and (assigned_to = auth.uid() or auth_role()::text in ('super_admin', 'administrateur', 'manager')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy deals_remove on deals for delete using (
    organization_id = auth_org_id() and auth_role()::text in ('super_admin', 'administrateur', 'manager'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mfa_required on deals as restrictive for all to authenticated using ((select mfa_satisfied()));
exception when duplicate_object then null; end $$;

-- Garde : seule la direction réattribue une affaire ; dates de clôture tenues à jour.
create or replace function public.deals_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_internal boolean := pg_trigger_depth() > 1 or auth.uid() is null;
  v_direction boolean := coalesce(auth_role()::text, '') in ('super_admin', 'administrateur', 'manager');
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if not v_internal then new.created_by := auth.uid(); end if;
  elsif not v_internal and not v_direction and new.assigned_to is distinct from old.assigned_to then
    raise exception 'Seule la direction peut réattribuer une affaire.';
  end if;
  if new.stage in ('gagnee', 'perdue') and (tg_op = 'INSERT' or old.stage not in ('gagnee', 'perdue')) then
    new.closed_at := now();
  elsif new.stage not in ('gagnee', 'perdue') then
    new.closed_at := null;
  end if;
  if new.lead_id is not null and not exists (select 1 from prospects where id = new.lead_id and organization_id = new.organization_id) then
    raise exception 'Lead introuvable.';
  end if;
  if new.client_id is not null and not exists (select 1 from clients where id = new.client_id and organization_id = new.organization_id) then
    raise exception 'Contact introuvable.';
  end if;
  if new.document_id is not null and not exists (select 1 from documents where id = new.document_id and organization_id = new.organization_id) then
    raise exception 'Document introuvable.';
  end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_deals_guard') then
    create trigger trg_deals_guard before insert or update on deals
      for each row execute function deals_guard();
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_audit_deals') then
    create trigger trg_audit_deals after insert or update or delete on deals
      for each row execute function audit_trigger_fn();
  end if;
end $$;

-- Le circuit de vente fait avancer l'affaire : la proforma passée en
-- commande ou facturée entraîne l'affaire avec elle.
create or replace function public.deals_follow_documents()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_deal uuid;
begin
  if new.parent_document_id is not null then
    update deals
       set document_id = new.id,
           stage = case when stage in ('gagnee', 'perdue') then stage else 'commande' end
     where document_id = new.parent_document_id
       and new.document_type::text in ('commande', 'facture');
  elsif new.document_type::text in ('devis', 'proforma') and new.client_id is not null then
    -- Nouvelle facture proforma : rattachée à l'affaire ouverte du même
    -- commercial pour ce contact, si elle n'a pas encore de document.
    select id into v_deal from deals
     where client_id = new.client_id and assigned_to = new.commercial_id
       and document_id is null and stage in ('decouverte', 'proforma', 'negociation')
     order by updated_at desc limit 1;
    if v_deal is not null then
      update deals
         set document_id = new.id,
             stage = case when stage = 'decouverte' then 'proforma' else stage end
       where id = v_deal;
    end if;
  end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_deals_follow_documents') then
    create trigger trg_deals_follow_documents after insert on documents
      for each row execute function deals_follow_documents();
  end if;
end $$;

-- Premier versement sur la facture : affaire gagnée.
create or replace function public.deals_on_payment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update deals set stage = 'gagnee'
   where document_id = new.document_id and stage not in ('gagnee', 'perdue');
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_deals_on_payment') then
    create trigger trg_deals_on_payment after insert on payments
      for each row execute function deals_on_payment();
  end if;
end $$;

-- Lead transformé en fiche contact : ses affaires suivent le contact.
create or replace function public.deals_follow_lead_conversion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.client_id is not null and new.client_id is distinct from old.client_id then
    update deals set client_id = new.client_id where lead_id = new.id and client_id is null;
  end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_deals_follow_lead_conversion') then
    create trigger trg_deals_follow_lead_conversion after update on prospects
      for each row execute function deals_follow_lead_conversion();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Agenda
-- ---------------------------------------------------------------------------
create table if not exists agenda_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  assigned_to uuid not null references profiles(id),
  created_by uuid references profiles(id),
  event_type text not null default 'rdv' check (event_type in ('rdv', 'relance', 'essai', 'livraison', 'autre')),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  notes text,
  status text not null default 'prevu' check (status in ('prevu', 'fait', 'annule')),
  lead_id uuid references prospects(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  deal_id uuid references deals(id) on delete set null,
  vehicle_unit_id uuid references vehicle_units(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index if not exists agenda_events_owner_idx on agenda_events (organization_id, assigned_to, starts_at);
alter table agenda_events enable row level security;

do $$ begin
  create policy agenda_select on agenda_events for select using (
    organization_id = auth_org_id()
    and (assigned_to = auth.uid() or auth_role()::text in ('super_admin', 'administrateur', 'manager', 'chef_service')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy agenda_insert on agenda_events for insert with check (
    organization_id = auth_org_id()
    and (assigned_to = auth.uid() or auth_role()::text in ('super_admin', 'administrateur', 'manager', 'chef_service')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy agenda_update on agenda_events for update using (
    organization_id = auth_org_id()
    and (assigned_to = auth.uid() or auth_role()::text in ('super_admin', 'administrateur', 'manager', 'chef_service')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy agenda_remove on agenda_events for delete using (
    organization_id = auth_org_id()
    and (assigned_to = auth.uid() or auth_role()::text in ('super_admin', 'administrateur', 'manager')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mfa_required on agenda_events as restrictive for all to authenticated using ((select mfa_satisfied()));
exception when duplicate_object then null; end $$;

create or replace function public.agenda_events_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' and auth.uid() is not null then new.created_by := auth.uid(); end if;
  if not exists (select 1 from profiles where id = new.assigned_to and organization_id = new.organization_id) then
    raise exception 'Commercial introuvable.';
  end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_agenda_events_guard') then
    create trigger trg_agenda_events_guard before insert or update on agenda_events
      for each row execute function agenda_events_guard();
  end if;
end $$;

-- Agenda fusionné : événements de l'agenda + rendez-vous et relances des leads.
-- p_user null : son propre agenda (ou celui de tous pour la direction).
create or replace function public.get_agenda(p_from timestamptz, p_to timestamptz, p_user uuid default null)
returns table (
  source text, id uuid, event_type text, title text, starts_at timestamptz, ends_at timestamptz,
  status text, location text, notes text, owner_id uuid, owner_name text,
  lead_id uuid, client_id uuid, deal_id uuid, contact_name text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_all boolean := coalesce(auth_role()::text, '') in ('super_admin', 'administrateur', 'manager', 'chef_service');
begin
  if auth.uid() is null or auth_org_id() is null then raise exception 'Accès refusé.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;
  if p_user is not null and p_user <> auth.uid() and not v_all then
    raise exception 'Seule la direction consulte l''agenda des autres.';
  end if;
  if p_to - p_from > interval '93 days' then raise exception 'Période trop longue.'; end if;

  return query
  select * from (
    select 'agenda'::text, e.id, e.event_type, e.title, e.starts_at, e.ends_at, e.status, e.location, e.notes,
           e.assigned_to, pr.full_name, e.lead_id, e.client_id, e.deal_id,
           coalesce(nullif(c.company_name, ''), nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''),
                    nullif(l.company_name, ''), nullif(trim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')), ''))
      from agenda_events e
      left join profiles pr on pr.id = e.assigned_to
      left join clients c on c.id = e.client_id
      left join prospects l on l.id = e.lead_id
     where e.organization_id = auth_org_id() and e.starts_at >= p_from and e.starts_at < p_to
    union all
    select 'rdv_lead', a.id, 'rdv', 'Rendez-vous', a.scheduled_at, null::timestamptz,
           case a.status::text when 'realise' then 'fait' when 'annule' then 'annule' when 'absent' then 'annule' else 'prevu' end,
           a.location, a.notes, l.assigned_to, pr.full_name, l.id, l.client_id, null::uuid,
           coalesce(nullif(l.company_name, ''), nullif(trim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')), ''))
      from prospect_appointments a
      join prospects l on l.id = a.prospect_id
      left join profiles pr on pr.id = l.assigned_to
     where l.organization_id = auth_org_id() and a.scheduled_at >= p_from and a.scheduled_at < p_to
    union all
    select 'relance_lead', l.id, 'relance', 'Relance', l.next_relance_at, null::timestamptz, 'prevu',
           null::text, null::text, l.assigned_to, pr.full_name, l.id, l.client_id, null::uuid,
           coalesce(nullif(l.company_name, ''), nullif(trim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')), ''))
      from prospects l
      left join profiles pr on pr.id = l.assigned_to
     where l.organization_id = auth_org_id() and l.next_relance_at >= p_from and l.next_relance_at < p_to
       and l.status::text not in ('converti', 'perdu')
  ) x (source, id, event_type, title, starts_at, ends_at, status, location, notes, owner_id, owner_name, lead_id, client_id, deal_id, contact_name)
  where (p_user is not null and x.owner_id = p_user)
     or (p_user is null and (v_all or x.owner_id = auth.uid()))
  order by x.starts_at;
end;
$$;
revoke all on function public.get_agenda(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_agenda(timestamptz, timestamptz, uuid) to authenticated;

revoke all on function public.deals_guard() from public, anon, authenticated;
revoke all on function public.deals_follow_documents() from public, anon, authenticated;
revoke all on function public.deals_on_payment() from public, anon, authenticated;
revoke all on function public.deals_follow_lead_conversion() from public, anon, authenticated;
revoke all on function public.agenda_events_guard() from public, anon, authenticated;

-- Les chefs de service et la chargée marketing voient les noms de l'équipe
-- (affaires, agendas et leads filtrés par commercial).
alter policy profiles_select_team on profiles using (
  organization_id = auth_org_id() and
  auth_role()::text = any (array['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'chef_atelier', 'admin_ventes', 'chef_service', 'marketing']));
