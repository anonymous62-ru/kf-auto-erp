-- Retours de la direction du 09/10/2026, étape 4 : pilotage.
--
--  - CAMPAGNES : actions du service marketing et communication (nom, canal,
--    dates, budget prévu, dépensé, objectif). Chaque lead peut être rattaché
--    à la campagne qui l'a apporté : on mesure leads générés, leads
--    transformés, affaires gagnées et coût par lead.
--  - RAPPORTS : une fonction report_summary calcule en une fois les chiffres
--    d'une période (ventes, activité par commercial, stock, origine des leads,
--    campagnes) pour la direction.

-- ---------------------------------------------------------------------------
-- Campagnes
-- ---------------------------------------------------------------------------
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  channel text not null default 'facebook'
    check (channel in ('facebook', 'instagram', 'tiktok', 'whatsapp', 'site_web', 'radio', 'television',
                       'affichage', 'presse', 'sms', 'salon', 'evenement', 'autre')),
  start_date date not null default current_date,
  end_date date,
  budget numeric not null default 0 check (budget >= 0),
  spent numeric not null default 0 check (spent >= 0),
  objective text,
  status text not null default 'preparation' check (status in ('preparation', 'en_cours', 'terminee', 'annulee')),
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index if not exists campaigns_org_idx on campaigns (organization_id, start_date desc);
alter table campaigns enable row level security;

alter table prospects add column if not exists campaign_id uuid references campaigns(id) on delete set null;
create index if not exists prospects_campaign_idx on prospects (campaign_id);

-- Tout le monde voit la liste des campagnes (pour rattacher un lead) ;
-- marketing et direction les gèrent.
do $$ begin
  create policy campaigns_select on campaigns for select using (organization_id = auth_org_id());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy campaigns_insert on campaigns for insert with check (
    organization_id = auth_org_id() and auth_role()::text in ('super_admin', 'administrateur', 'manager', 'marketing'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy campaigns_update on campaigns for update using (
    organization_id = auth_org_id() and auth_role()::text in ('super_admin', 'administrateur', 'manager', 'marketing'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy campaigns_remove on campaigns for delete using (
    organization_id = auth_org_id() and auth_role()::text in ('super_admin', 'administrateur', 'manager'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mfa_required on campaigns as restrictive for all to authenticated using ((select mfa_satisfied()));
exception when duplicate_object then null; end $$;

create or replace function public.campaigns_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' and auth.uid() is not null then new.created_by := auth.uid(); end if;
  new.name := trim(new.name);
  if new.name = '' then raise exception 'Le nom de la campagne est obligatoire.'; end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_campaigns_guard') then
    create trigger trg_campaigns_guard before insert or update on campaigns
      for each row execute function campaigns_guard();
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_audit_campaigns') then
    create trigger trg_audit_campaigns after insert or update or delete on campaigns
      for each row execute function audit_trigger_fn();
  end if;
end $$;

-- Résultats par campagne (tous les leads, même ceux des autres commerciaux :
-- seuls des totaux sortent de cette fonction).
create or replace function public.campaign_stats()
returns table (
  campaign_id uuid, leads bigint, leads_converted bigint, deals_open bigint, deals_won bigint,
  won_amount numeric, invoiced_amount numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth_role()::text, '') not in ('super_admin', 'administrateur', 'manager', 'marketing', 'admin_ventes', 'chef_service') then
    raise exception 'Accès refusé.';
  end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;
  return query
  select c.id,
         (select count(*) from prospects l where l.campaign_id = c.id),
         (select count(*) from prospects l where l.campaign_id = c.id and (l.status::text = 'converti' or l.client_id is not null)),
         (select count(*) from deals d join prospects l on l.id = d.lead_id or (l.client_id is not null and l.client_id = d.client_id)
           where l.campaign_id = c.id and d.stage in ('decouverte', 'proforma', 'negociation', 'commande')),
         (select count(*) from deals d join prospects l on l.id = d.lead_id or (l.client_id is not null and l.client_id = d.client_id)
           where l.campaign_id = c.id and d.stage = 'gagnee'),
         (select coalesce(sum(d.estimated_amount), 0) from deals d join prospects l on l.id = d.lead_id or (l.client_id is not null and l.client_id = d.client_id)
           where l.campaign_id = c.id and d.stage = 'gagnee'),
         (select coalesce(sum(doc.total_amount), 0) from documents doc join prospects l on l.client_id = doc.client_id
           where l.campaign_id = c.id and doc.document_type::text = 'facture' and doc.status::text <> 'annule')
    from campaigns c
   where c.organization_id = auth_org_id();
end;
$$;
revoke all on function public.campaign_stats() from public, anon;
grant execute on function public.campaign_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- Rapport de période (direction)
-- ---------------------------------------------------------------------------
create or replace function public.report_summary(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := auth_org_id();
  v_result jsonb;
begin
  if coalesce(auth_role()::text, '') not in ('super_admin', 'administrateur', 'manager', 'admin_ventes', 'chef_service') then
    raise exception 'Les rapports sont réservés à la direction.';
  end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Période invalide.'; end if;
  if p_to - p_from > 1100 then raise exception 'Période trop longue (3 ans au plus).'; end if;

  with
  fac as (
    select d.* from documents d
     where d.organization_id = v_org and d.document_type::text = 'facture' and d.status::text <> 'annule'
       and d.issue_date between p_from and p_to
  ),
  pay as (
    select p.*, d.commercial_id from payments p join documents d on d.id = p.document_id
     where p.organization_id = v_org and p.payment_date between p_from and p_to
  ),
  pro as (
    select d.* from documents d
     where d.organization_id = v_org and d.document_type::text in ('devis', 'proforma') and d.status::text <> 'annule'
       and d.issue_date between p_from and p_to
  ),
  cmd as (
    select d.* from documents d
     where d.organization_id = v_org and d.document_type::text = 'commande' and d.status::text <> 'annule'
       and d.issue_date between p_from and p_to
  ),
  months as (
    select to_char(m, 'YYYY-MM') as month
      from generate_series(date_trunc('month', p_from::timestamp), date_trunc('month', p_to::timestamp), interval '1 month') m
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'sales', jsonb_build_object(
      'invoiced', (select coalesce(sum(total_amount), 0) from fac),
      'invoices', (select count(*) from fac),
      'collected', (select coalesce(sum(amount), 0) from pay),
      'unpaid_total', (select coalesce(sum(balance_due), 0) from documents
                        where organization_id = v_org and document_type::text = 'facture'
                          and status::text not in ('paye', 'annule') and balance_due > 0),
      'proformas', (select count(*) from pro),
      'proformas_amount', (select coalesce(sum(total_amount), 0) from pro),
      'orders', (select count(*) from cmd),
      'orders_to_invoice', (select count(*) from documents where organization_id = v_org and document_type::text = 'commande'
                              and status::text not in ('accepte', 'annule')),
      'vehicles_sold', (select coalesce(sum(i.quantity), 0) from fac join document_items i on i.document_id = fac.id
                          join products pr on pr.id = i.product_id)
    ),
    'by_month', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'month', m.month,
               'invoiced', (select coalesce(sum(total_amount), 0) from fac where to_char(issue_date, 'YYYY-MM') = m.month),
               'collected', (select coalesce(sum(amount), 0) from pay where to_char(payment_date, 'YYYY-MM') = m.month),
               'invoices', (select count(*) from fac where to_char(issue_date, 'YYYY-MM') = m.month)
             ) order by m.month), '[]'::jsonb)
        from months m
    ),
    'by_model', (
      select coalesce(jsonb_agg(x order by (x->>'amount')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object('model', pr.designation, 'quantity', sum(i.quantity), 'amount', sum(i.line_total)) as x
          from fac join document_items i on i.document_id = fac.id join products pr on pr.id = i.product_id
         group by pr.designation
      ) t
    ),
    'by_commercial', (
      select coalesce(jsonb_agg(x order by (x->>'invoiced')::numeric desc, x->>'name'), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', p.id, 'name', p.full_name, 'role', p.role::text,
          'proformas', (select count(*) from pro where pro.commercial_id = p.id),
          'orders', (select count(*) from cmd where cmd.commercial_id = p.id),
          'invoices', (select count(*) from fac where fac.commercial_id = p.id),
          'invoiced', (select coalesce(sum(total_amount), 0) from fac where fac.commercial_id = p.id),
          'collected', (select coalesce(sum(amount), 0) from pay where pay.commercial_id = p.id),
          'leads', (select count(*) from prospects l where l.assigned_to = p.id and l.created_at::date between p_from and p_to),
          'deals_won', (select count(*) from deals d where d.assigned_to = p.id and d.stage = 'gagnee' and d.closed_at::date between p_from and p_to),
          'deals_lost', (select count(*) from deals d where d.assigned_to = p.id and d.stage = 'perdue' and d.closed_at::date between p_from and p_to),
          'deals_open', (select count(*) from deals d where d.assigned_to = p.id and d.stage in ('decouverte', 'proforma', 'negociation', 'commande')),
          'pipeline', (select coalesce(sum(estimated_amount), 0) from deals d where d.assigned_to = p.id and d.stage in ('decouverte', 'proforma', 'negociation', 'commande')),
          'events_done', (select count(*) from agenda_events e where e.assigned_to = p.id and e.status = 'fait' and e.starts_at::date between p_from and p_to)
        ) as x
          from profiles p
         where p.organization_id = v_org and p.is_active
           and (p.role::text in ('commercial', 'chef_service', 'responsable_showroom', 'vendeur_showroom')
                or exists (select 1 from documents d where d.commercial_id = p.id and d.issue_date between p_from and p_to))
      ) t
    ),
    'stock', (
      select coalesce(jsonb_agg(x order by x->>'model'), '[]'::jsonb) from (
        select jsonb_build_object(
          'model', pr.designation,
          'tracked', exists (select 1 from vehicle_units u where u.product_id = pr.id),
          'in_stock', pr.quantity_on_hand,
          'value', pr.quantity_on_hand * pr.sale_price,
          'free', (select count(*) from vehicle_units u where u.product_id = pr.id and u.status = 'disponible'
                     and vehicle_unit_active_document(u.id) is null),
          'reserved', (select count(*) from vehicle_units u where u.product_id = pr.id
                         and (u.status = 'reserve' or (u.status = 'disponible' and vehicle_unit_active_document(u.id) is not null))),
          'other', (select count(*) from vehicle_units u where u.product_id = pr.id and u.status in ('demo', 'essai', 'endommage')),
          'avg_age_days', (select round(avg(current_date - u.entry_date)) from vehicle_units u where u.product_id = pr.id and u.status <> 'vendu'),
          'over_90_days', (select count(*) from vehicle_units u where u.product_id = pr.id and u.status <> 'vendu' and current_date - u.entry_date > 90),
          'sold_period', (select coalesce(sum(i.quantity), 0) from fac join document_items i on i.document_id = fac.id where i.product_id = pr.id)
        ) as x
          from products pr
         where pr.organization_id = v_org and coalesce(pr.is_archived, false) = false
      ) t
    ),
    'parts', jsonb_build_object(
      'references', (select count(*) from parts where organization_id = v_org and is_active),
      'below_min', (select count(*) from parts where organization_id = v_org and is_active
                      and quantity_on_hand - coalesce(quantity_reserved, 0) <= coalesce(stock_min, 0)),
      'to_activate', (select count(*) from parts where organization_id = v_org and not is_active)
    ),
    'leads_by_source', (
      select coalesce(jsonb_agg(x order by (x->>'count')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('source', l.source::text, 'count', count(*),
                                  'converted', count(*) filter (where l.status::text = 'converti' or l.client_id is not null)) as x
          from prospects l
         where l.organization_id = v_org and l.created_at::date between p_from and p_to
         group by l.source
      ) t
    ),
    'deals', jsonb_build_object(
      'open', (select count(*) from deals where organization_id = v_org and stage in ('decouverte', 'proforma', 'negociation', 'commande')),
      'pipeline', (select coalesce(sum(estimated_amount), 0) from deals where organization_id = v_org and stage in ('decouverte', 'proforma', 'negociation', 'commande')),
      'hot', (select count(*) from deals where organization_id = v_org and temperature = 'chaude' and stage in ('decouverte', 'proforma', 'negociation', 'commande')),
      'won', (select count(*) from deals where organization_id = v_org and stage = 'gagnee' and closed_at::date between p_from and p_to),
      'lost', (select count(*) from deals where organization_id = v_org and stage = 'perdue' and closed_at::date between p_from and p_to),
      'lost_reasons', (select coalesce(jsonb_agg(jsonb_build_object('reason', lost_reason, 'count', n) order by n desc), '[]'::jsonb) from (
                          select coalesce(nullif(trim(lost_reason), ''), 'Non précisé') as lost_reason, count(*) as n from deals
                           where organization_id = v_org and stage = 'perdue' and closed_at::date between p_from and p_to
                           group by 1 order by 2 desc limit 8) r)
    )
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.report_summary(date, date) from public, anon;
grant execute on function public.report_summary(date, date) to authenticated;

revoke all on function public.campaigns_guard() from public, anon, authenticated;
