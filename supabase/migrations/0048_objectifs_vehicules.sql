-- =============================================================================
-- 0048 : Objectifs commerciaux en nombre de véhicules (demande du 16/11/2026)
--
--   - Les objectifs ne sont plus fixés en F CFA mais en nombre de véhicules
--     vendus, par commercial et par période, éventuellement par modèle.
--   - Le réalisé est calculé à partir des factures émises.
--   - La colonne organizations.monthly_target (F CFA) est conservée mais
--     n'est plus utilisée par l'application.
--
-- Règle de calcul du réalisé (fonction objective_units) :
--   * factures (document_type 'facture') au circuit « émise »
--     (workflow_status = 'emise') et non annulées (status <> 'annule') ;
--   * du commercial de l'objectif (documents.commercial_id), dont la date
--     d'émission (issue_date) est comprise dans la période de l'objectif ;
--   * un véhicule = une ligne de facture rattachée à un modèle du catalogue
--     véhicules (document_items.product_id non nul : la table products ne
--     contient que les modèles, les pièces sont dans « parts ») ; on compte
--     la quantité de la ligne ; filtre par modèle si l'objectif en a un ;
--   * avoirs : un avoir total annule la facture (status 'annule'), elle sort
--     donc du réalisé. Un avoir partiel non annulé retire les véhicules de
--     ses lignes rattachées au même modèle lorsque la ligne rembourse le
--     prix du véhicule (prix net unitaire au moins égal à celui facturé) ;
--     un avoir de simple geste commercial (remise sur le prix) ne retire
--     aucun véhicule. Le retrait est imputé à la période de la facture
--     d'origine et ne peut pas rendre le compte négatif.
-- =============================================================================

create table if not exists public.sales_objectives (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  product_id uuid references public.products(id) on delete cascade,
  target_units integer not null check (target_units > 0 and target_units <= 10000),
  notes text check (notes is null or length(notes) <= 500),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_objectives_period_check check (period_end >= period_start and period_end - period_start <= 366)
);
create unique index if not exists sales_objectives_uniq
  on public.sales_objectives (user_id, period_start, period_end, product_id) nulls not distinct;
create index if not exists sales_objectives_period_idx
  on public.sales_objectives (organization_id, period_start, period_end);

-- Cohérence : commercial et modèle de la même organisation, auteur et date
-- de mise à jour posés par la base.
create or replace function public.sales_objectives_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = new.user_id and organization_id = new.organization_id) then
    raise exception 'Commercial introuvable dans votre organisation.';
  end if;
  if new.product_id is not null
     and not exists (select 1 from products where id = new.product_id and organization_id = new.organization_id) then
    raise exception 'Modèle introuvable.';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.organization_id := old.organization_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger sales_objectives_guard
  before insert or update on public.sales_objectives
  for each row execute function public.sales_objectives_guard();

-- Qui fixe les objectifs : la direction et le responsable commercial.
create or replace function public.can_manage_objectives()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth_role()::text, '') in ('super_admin', 'administrateur', 'manager', 'responsable_commercial');
$$;
revoke all on function public.can_manage_objectives() from public, anon;
grant execute on function public.can_manage_objectives() to authenticated;

alter table public.sales_objectives enable row level security;

create policy sales_objectives_select on public.sales_objectives for select to authenticated using (
  organization_id = auth_org_id() and (can_manage_objectives() or user_id = auth.uid())
);
create policy sales_objectives_insert on public.sales_objectives for insert to authenticated with check (
  organization_id = auth_org_id() and can_manage_objectives()
);
create policy sales_objectives_update on public.sales_objectives for update to authenticated
  using (organization_id = auth_org_id() and can_manage_objectives())
  with check (organization_id = auth_org_id() and can_manage_objectives());
create policy sales_objectives_delete on public.sales_objectives for delete to authenticated using (
  organization_id = auth_org_id() and can_manage_objectives()
);
create policy mfa_required on public.sales_objectives as restrictive for all to authenticated
  using ((select mfa_satisfied())) with check ((select mfa_satisfied()));

revoke all on public.sales_objectives from anon;
grant select, insert, update, delete on public.sales_objectives to authenticated;

-- -----------------------------------------------------------------------------
-- Réalisé : véhicules facturés (fonction interne, non exposée)
--   p_user null = toute l'organisation ; p_product null = tous modèles.
-- -----------------------------------------------------------------------------
create or replace function public.objective_units(p_org uuid, p_user uuid, p_product uuid, p_from date, p_to date)
returns integer language sql stable security definer set search_path = public as $$
  with lines as (
    select f.id as fid, i.product_id,
           sum(i.quantity) as qty,
           max(i.unit_price * (1 - coalesce(i.discount_percent, 0) / 100)) as unit_net
      from documents f
      join document_items i on i.document_id = f.id
     where f.organization_id = p_org
       and f.document_type::text = 'facture'
       and f.workflow_status = 'emise'
       and f.status::text <> 'annule'
       and f.issue_date between p_from and p_to
       and (p_user is null or f.commercial_id = p_user)
       and i.product_id is not null
       and (p_product is null or i.product_id = p_product)
     group by f.id, i.product_id
  ), returned as (
    select l.fid, l.product_id, sum(ai.quantity) as qty
      from lines l
      join documents a on a.parent_document_id = l.fid
                      and a.document_type::text = 'avoir'
                      and a.status::text <> 'annule'
      join document_items ai on ai.document_id = a.id and ai.product_id = l.product_id
     where ai.unit_price * (1 - coalesce(ai.discount_percent, 0) / 100) >= l.unit_net - 1
     group by l.fid, l.product_id
  )
  select coalesce(sum(greatest(l.qty - coalesce(r.qty, 0), 0)), 0)::int
    from lines l left join returned r on r.fid = l.fid and r.product_id = l.product_id;
$$;
revoke all on function public.objective_units(uuid, uuid, uuid, date, date) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Avancement des objectifs qui chevauchent la période demandée.
-- Direction et responsable commercial : tous ; les autres : les leurs.
-- -----------------------------------------------------------------------------
create or replace function public.objectives_progress(p_from date, p_to date)
returns table (
  objective_id uuid, user_id uuid, user_name text, user_role text,
  product_id uuid, product_label text, period_start date, period_end date,
  target_units integer, achieved_units integer, pct integer, notes text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := auth_org_id();
  v_all boolean := can_manage_objectives();
begin
  if auth.uid() is null or v_org is null then raise exception 'Session expirée, reconnectez-vous.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Période invalide.';
  end if;
  return query
    select o.id, o.user_id, coalesce(pr.full_name, ''), pr.role::text,
           o.product_id, coalesce(p.model, p.designation),
           o.period_start, o.period_end, o.target_units, x.units,
           round(x.units * 100.0 / o.target_units)::int, o.notes
      from sales_objectives o
      join profiles pr on pr.id = o.user_id
      left join products p on p.id = o.product_id
      cross join lateral (select objective_units(v_org, o.user_id, o.product_id, o.period_start, o.period_end) as units) x
     where o.organization_id = v_org
       and o.period_start <= p_to and o.period_end >= p_from
       and (v_all or o.user_id = auth.uid())
     order by pr.full_name, o.period_start, o.product_id nulls first;
end;
$$;
revoke all on function public.objectives_progress(date, date) from public, anon;
grant execute on function public.objectives_progress(date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Compte-tours du mois (fuseau de Lomé) :
--   org_target   : somme des objectifs dont la période est dans le mois ; par
--                  commercial, l'objectif « tous modèles » s'il existe, sinon
--                  la somme de ses objectifs par modèle (pas de double compte) ;
--   org_achieved : véhicules facturés du mois par toute l'organisation ;
--   my_target / my_achieved : la même chose pour l'utilisateur connecté.
-- -----------------------------------------------------------------------------
create or replace function public.objectives_month_total(p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := auth_org_id();
  v_today date := (now() at time zone 'Africa/Lome')::date;
  v_start date := date_trunc('month', coalesce(p_month, v_today))::date;
  v_end date := (date_trunc('month', coalesce(p_month, v_today)) + interval '1 month - 1 day')::date;
  v_org_target int; v_my_target int;
begin
  if auth.uid() is null or v_org is null then raise exception 'Session expirée, reconnectez-vous.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;

  with per_user as (
    select o.user_id,
           coalesce(sum(o.target_units) filter (where o.product_id is null),
                    sum(o.target_units)) as target
      from sales_objectives o
     where o.organization_id = v_org and o.period_start >= v_start and o.period_end <= v_end
     group by o.user_id
  )
  select coalesce(sum(target), 0), coalesce(sum(target) filter (where user_id = auth.uid()), 0)
    into v_org_target, v_my_target
    from per_user;

  return jsonb_build_object(
    'month_start', v_start,
    'month_end', v_end,
    'org_target', v_org_target,
    'org_achieved', objective_units(v_org, null, null, v_start, v_end),
    'my_target', v_my_target,
    'my_achieved', objective_units(v_org, auth.uid(), null, v_start, v_end)
  );
end;
$$;
revoke all on function public.objectives_month_total(date) from public, anon;
grant execute on function public.objectives_month_total(date) to authenticated;
