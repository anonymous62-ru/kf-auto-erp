-- =============================================================================
-- 0056 : Tableau de bord du commercial sans les ventes globales (17/11/2026)
--
-- Demande : « Le commercial doit pas voir les ventes global sur son tableau
-- de bord. » Le droit ventes_globales (migration 0054, modifiable par le super
-- admin) décide désormais, côté base, si les totaux d'organisation sont
-- renvoyés :
--   - objectives_month_total : org_target = 0 et org_achieved = null sans le
--     droit ; le champ scope vaut 'org' ou 'me' ;
--   - monthly_target_progress : sans le droit, objectif d'organisation à 0 et
--     facturé limité aux documents du commercial connecté (commercial_id).
-- objectives_progress ne change pas : elle ne renvoie déjà que les objectifs
-- de l'utilisateur connecté, sauf aux rôles qui gèrent les objectifs.
-- Aucune suppression de politique, de déclencheur ni de données.
-- =============================================================================

create or replace function public.objectives_month_total(p_month date default null)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_org uuid := auth_org_id();
  v_today date := (now() at time zone 'Africa/Lome')::date;
  v_start date := date_trunc('month', coalesce(p_month, v_today))::date;
  v_end date := (date_trunc('month', coalesce(p_month, v_today)) + interval '1 month - 1 day')::date;
  v_global boolean := coalesce(has_permission('ventes_globales'), false);
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
    'scope', case when v_global then 'org' else 'me' end,
    'org_target', case when v_global then v_org_target else 0 end,
    'org_achieved', case when v_global then objective_units(v_org, null, null, v_start, v_end) end,
    'my_target', v_my_target,
    'my_achieved', objective_units(v_org, auth.uid(), null, v_start, v_end)
  );
end;
$$;
revoke all on function public.objectives_month_total(date) from public, anon;
grant execute on function public.objectives_month_total(date) to authenticated;

create or replace function public.monthly_target_progress()
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_org uuid := auth_org_id();
  v_today date := (now() at time zone 'Africa/Lome')::date;
  v_start date := date_trunc('month', v_today)::date;
  v_prev_start date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_prev_same date := least(v_prev_start + (v_today - v_start), v_start - 1);
  v_global boolean := coalesce(has_permission('ventes_globales'), false);
  v_me uuid := auth.uid();
  v_target numeric;
begin
  if v_org is null then raise exception 'Session expirée, reconnectez-vous.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;
  select monthly_target into v_target from organizations where id = v_org;
  return jsonb_build_object(
    'scope', case when v_global then 'org' else 'me' end,
    'target', case when v_global then coalesce(v_target, 0) else 0 end,
    'invoiced', (
      select coalesce(sum(total_amount), 0) from documents
       where organization_id = v_org and document_type::text = 'facture' and status::text <> 'annule'
         and issue_date between v_start and v_today
         and (v_global or commercial_id = v_me))
      - (select coalesce(sum(a.total_amount), 0) from documents a join documents f on f.id = a.parent_document_id
          where a.organization_id = v_org and a.document_type::text = 'avoir' and a.status::text <> 'annule'
            and f.status::text <> 'annule' and a.issue_date between v_start and v_today
            and (v_global or f.commercial_id = v_me)),
    'invoiced_prev_same_period', (
      select coalesce(sum(total_amount), 0) from documents
       where organization_id = v_org and document_type::text = 'facture' and status::text <> 'annule'
         and issue_date between v_prev_start and v_prev_same
         and (v_global or commercial_id = v_me)),
    'today', v_today
  );
end;
$$;
revoke all on function public.monthly_target_progress() from public, anon;
grant execute on function public.monthly_target_progress() to authenticated;
