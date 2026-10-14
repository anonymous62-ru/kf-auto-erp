-- =============================================================================
-- 0041 : Tableau de bord « cockpit » (direction, 13/10/2026)
--   - objectif mensuel de ventes, réglé par la direction ;
--   - type de carrosserie des modèles (silhouette SUV ou pick-up) ;
--   - progression de l'objectif calculée sur toute l'organisation.
-- =============================================================================

alter table public.organizations add column if not exists monthly_target numeric(14, 0) not null default 0;
alter table public.organizations add constraint organizations_monthly_target_check check (monthly_target >= 0);

alter table public.products add column if not exists body_type text not null default 'suv';
alter table public.products add constraint products_body_type_check check (body_type in ('suv', 'pickup'));
update public.products set body_type = 'pickup'
 where body_type = 'suv' and (designation ilike '%pick%' or designation ilike '%himla%' or model ilike '%himla%');

-- Objectif mensuel : modifiable par la direction uniquement.
create or replace function public.set_monthly_target(p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Session expirée, reconnectez-vous.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;
  if coalesce(auth_role()::text, '') not in ('super_admin', 'administrateur', 'manager') then
    raise exception 'Seule la direction fixe l''objectif mensuel.';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 100000000000 then
    raise exception 'Montant invalide.';
  end if;
  update organizations set monthly_target = round(p_amount), updated_at = now() where id = auth_org_id();
end;
$$;
revoke all on function public.set_monthly_target(numeric) from public, anon;
grant execute on function public.set_monthly_target(numeric) to authenticated;

-- Progression de l'objectif : facturé du mois (factures non annulées, moins
-- les avoirs partiels) pour toute l'organisation, et le même chiffre au même
-- jour du mois précédent. Visible par tous les rôles connectés.
create or replace function public.monthly_target_progress()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := auth_org_id();
  v_today date := (now() at time zone 'Africa/Lome')::date;
  v_start date := date_trunc('month', v_today)::date;
  v_prev_start date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_prev_same date := least(v_prev_start + (v_today - v_start), v_start - 1);
  v_target numeric;
begin
  if v_org is null then raise exception 'Session expirée, reconnectez-vous.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;
  select monthly_target into v_target from organizations where id = v_org;
  return jsonb_build_object(
    'target', coalesce(v_target, 0),
    'invoiced', (
      select coalesce(sum(total_amount), 0) from documents
       where organization_id = v_org and document_type::text = 'facture' and status::text <> 'annule'
         and issue_date between v_start and v_today)
      - (select coalesce(sum(a.total_amount), 0) from documents a join documents f on f.id = a.parent_document_id
          where a.organization_id = v_org and a.document_type::text = 'avoir' and a.status::text <> 'annule'
            and f.status::text <> 'annule' and a.issue_date between v_start and v_today),
    'invoiced_prev_same_period', (
      select coalesce(sum(total_amount), 0) from documents
       where organization_id = v_org and document_type::text = 'facture' and status::text <> 'annule'
         and issue_date between v_prev_start and v_prev_same),
    'today', v_today
  );
end;
$$;
revoke all on function public.monthly_target_progress() from public, anon;
grant execute on function public.monthly_target_progress() to authenticated;
