-- =============================================================================
-- 0045 : Paiement en plusieurs fois (étape 4 de la réunion du 16/11/2026)
--
--   1. Échéancier par facture (payment_installments) : acompte saisi comme un
--      paiement normal, le reste découpé en échéances (montant + date).
--      Contrôle en base : somme des échéances = reste dû (au franc près),
--      dates strictement croissantes, montants > 0.
--   2. Imputation automatique : chaque paiement solde les échéances dans
--      l'ordre ; statut a_venir / payee / en_retard tenu à jour.
--   3. Confirmation des paiements par la comptable (confirmed_at/by). Le
--      paiement compte immédiatement comme avant (rien n'est bloqué) ; s'il
--      est saisi par quelqu'un d'autre que la comptable, une action
--      « paiement_a_confirmer » est créée pour les comptables.
--   4. Rappels : generate_installment_reminders(), appelée par le cron
--      (service_role uniquement), J-3 et retard.
--   5. Idempotence de la saisie (payments.client_request_id) contre les
--      doubles clics / renvois réseau.
--
-- Aucun trigger existant de payments n'est modifié : apply_payment_to_document,
-- check_payment_not_over_balance, notify_payment_received,
-- promote_client_on_payment, vehicle_units_on_payment, deals_on_payment et
-- l'audit restent identiques. La table documents n'est pas modifiée.
--
-- Appliquée en production en 5 parties (0045a_echeancier_tables,
-- 0045b_echeancier_imputation, 0045c_echeancier_archive, 0045d_echeancier_rpc,
-- 0045e_echeancier_droits) ; ce fichier en est la version consolidée.
-- =============================================================================

-- 1. Paiements : confirmation + idempotence --------------------------------
alter table public.payments
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by uuid references public.profiles(id),
  add column if not exists client_request_id uuid;

create unique index if not exists payments_client_request_uniq
  on public.payments (client_request_id) where client_request_id is not null;

-- Les paiements déjà enregistrés sont considérés comme confirmés.
update public.payments
   set confirmed_at = coalesce(created_at, now())
 where confirmed_at is null;

-- 2. Échéancier ---------------------------------------------------------------
create table if not exists public.payment_installments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  seq int not null check (seq > 0),
  due_date date not null,
  amount numeric not null check (amount > 0),
  paid_amount numeric not null default 0 check (paid_amount >= 0),
  status text not null default 'a_venir' check (status in ('a_venir', 'payee', 'en_retard')),
  reminded_before_at timestamptz,
  reminded_overdue_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  -- Échéance remplacée lors d'une modification de l'échéancier : conservée
  -- pour l'historique, ignorée partout ailleurs.
  replaced_at timestamptz,
  replaced_by uuid references public.profiles(id),
  unique (document_id, seq)
);
create index if not exists payment_installments_due_idx
  on public.payment_installments (organization_id, status, due_date);
create index if not exists payment_installments_doc_idx
  on public.payment_installments (document_id, seq);

alter table public.payment_installments enable row level security;

-- Même visibilité que les paiements de la facture.
do $$
begin
  if not exists (select 1 from pg_policy where polrelid = 'public.payment_installments'::regclass
                  and polname = 'payment_installments_select') then
    create policy payment_installments_select on public.payment_installments
      for select to authenticated using (
        organization_id = auth_org_id()
        and (
          (auth_role())::text = any (array['super_admin', 'administrateur', 'comptable', 'manager',
                                           'receptionniste_sav', 'admin_ventes'])
          or exists (select 1 from documents d
                      where d.id = payment_installments.document_id and d.commercial_id = auth.uid())
        )
      );
  end if;
  if not exists (select 1 from pg_policy where polrelid = 'public.payment_installments'::regclass
                  and polname = 'mfa_required') then
    create policy mfa_required on public.payment_installments as restrictive for all to authenticated
      using ((select mfa_satisfied())) with check ((select mfa_satisfied()));
  end if;
end;
$$;
-- Aucune écriture directe : uniquement par les fonctions ci-dessous.
revoke all on public.payment_installments from anon;
revoke insert, update, delete, truncate on public.payment_installments from authenticated;
grant select on public.payment_installments to authenticated;

-- 3. Imputation des paiements sur les échéances -----------------------------
-- Les échéances couvrent la fin de la facture : la part « hors échéancier »
-- (acompte et paiements antérieurs) vaut total - somme des échéances. Tout
-- ce qui est payé au-delà solde les échéances dans l'ordre.
create or replace function public.refresh_installments(p_document_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_paid numeric;
  v_sched numeric;
  v_pool numeric;
  v_alloc numeric;
  v_status text;
  r record;
begin
  select total_amount into v_total from documents where id = p_document_id;
  if v_total is null then return; end if;
  select coalesce(sum(amount), 0) into v_sched from payment_installments
   where document_id = p_document_id and replaced_at is null;
  if v_sched = 0 then return; end if;
  select coalesce(sum(amount), 0) into v_paid from payments where document_id = p_document_id;

  v_pool := greatest(v_paid - (v_total - v_sched), 0);
  for r in select * from payment_installments
            where document_id = p_document_id and replaced_at is null order by seq loop
    v_alloc := least(r.amount, v_pool);
    v_pool := v_pool - v_alloc;
    v_status := case
      when v_alloc >= r.amount - 0.5 then 'payee'
      when r.due_date < current_date then 'en_retard'
      else 'a_venir' end;
    if r.paid_amount is distinct from v_alloc or r.status is distinct from v_status then
      update payment_installments set paid_amount = v_alloc, status = v_status where id = r.id;
    end if;
    if v_status = 'payee' and r.status is distinct from 'payee' then
      perform resolve_actions(p_document_id, array['echeance'], r.id);
    end if;
  end loop;
end;
$$;

create or replace function public.installments_on_payment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform refresh_installments(case when tg_op = 'DELETE' then old.document_id else new.document_id end);
  return null;
end;
$$;

-- Confirmation : posée d'office si la comptable saisit elle-même, sinon
-- vide (le client ne peut pas se l'attribuer en insérant directement).
create or replace function public.payments_confirmation_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth_role()::text, '') = 'comptable' then
    new.confirmed_at := now();
    new.confirmed_by := auth.uid();
  elsif auth.uid() is not null then
    new.confirmed_at := null;
    new.confirmed_by := null;
  end if;
  return new;
end;
$$;

-- Action « paiement à confirmer » pour les comptables (à défaut : direction).
create or replace function public.payments_request_confirmation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_doc record;
  v_targets uuid[];
begin
  if new.confirmed_at is not null then return null; end if;
  select id, organization_id, document_number into v_doc from documents where id = new.document_id;
  if v_doc.id is null then return null; end if;

  select array_agg(u) into v_targets from org_user_ids(v_doc.organization_id, array['comptable']) u;
  if v_targets is null then
    select array_agg(u) into v_targets
      from org_user_ids(v_doc.organization_id, array['super_admin', 'administrateur', 'manager']) u
     where u is distinct from new.recorded_by;
  end if;
  if v_targets is null then return null; end if;

  perform create_action(
    'paiement_a_confirmer', v_targets,
    'Paiement à confirmer',
    format('Paiement de %s F CFA saisi sur %s, à confirmer après vérification de l''encaissement.',
           to_char(round(new.amount), 'FM999G999G999G990'), coalesce(v_doc.document_number, 'une facture')),
    '/documents/' || new.document_id,
    new.document_id, new.id,
    coalesce(document_mail_payload(new.document_id), '{}'::jsonb)
      || jsonb_build_object('payment_id', new.id, 'payment_amount', new.amount,
                            'payment_method', new.payment_method::text, 'payment_date', new.payment_date)
  );
  return null;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.payments'::regclass and tgname = 'trg_payments_confirmation_defaults') then
    create trigger trg_payments_confirmation_defaults before insert on public.payments
      for each row execute function public.payments_confirmation_defaults();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.payments'::regclass and tgname = 'trg_payments_request_confirmation') then
    create trigger trg_payments_request_confirmation after insert on public.payments
      for each row execute function public.payments_request_confirmation();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.payments'::regclass and tgname = 'trg_payments_installments') then
    create trigger trg_payments_installments after insert or delete on public.payments
      for each row execute function public.installments_on_payment();
  end if;
end;
$$;

-- 4. Validation et remplacement de l'échéancier (interne) -------------------
-- Conserve les échéances déjà payées, archive (replaced_at) toutes les autres
-- et les remplace par la liste fournie, qui doit couvrir exactement le reste dû courant.
create or replace function public.replace_installments(p_document_id uuid, p_installments jsonb, p_min_date date)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_doc record;
  v_paid numeric;
  v_remaining numeric;
  v_sum numeric := 0;
  v_prev date;
  v_seq int;
  v_n int;
  v_item jsonb;
  v_amount numeric;
  v_date date;
begin
  select id, organization_id, total_amount, status::text as status, document_type::text as document_type
    into v_doc from documents where id = p_document_id;
  if v_doc.document_type <> 'facture' then
    raise exception 'Un échéancier ne se crée que sur une facture.';
  end if;
  if v_doc.status = 'annule' then
    raise exception 'Facture annulée : pas d''échéancier possible.';
  end if;
  if p_installments is null or jsonb_typeof(p_installments) <> 'array' then
    raise exception 'Échéancier invalide.';
  end if;
  v_n := jsonb_array_length(p_installments);
  if v_n < 1 or v_n > 24 then
    raise exception 'Le nombre d''échéances doit être compris entre 1 et 24.';
  end if;

  select coalesce(sum(amount), 0) into v_paid from payments where document_id = p_document_id;
  v_remaining := v_doc.total_amount - v_paid;
  if v_remaining <= 0.5 then
    raise exception 'Cette facture est soldée : rien à échelonner.';
  end if;

  for v_item in select value from jsonb_array_elements(p_installments) loop
    begin
      v_amount := (v_item ->> 'amount')::numeric;
      v_date := (v_item ->> 'due_date')::date;
    exception when others then
      raise exception 'Échéance invalide : montant ou date illisible.';
    end;
    if v_amount is null or v_amount <= 0 then
      raise exception 'Chaque échéance doit avoir un montant supérieur à 0.';
    end if;
    if v_date is null then
      raise exception 'Chaque échéance doit avoir une date.';
    end if;
    if v_date < p_min_date then
      raise exception 'La date d''une échéance (%) ne peut pas être antérieure au %.',
        to_char(v_date, 'DD/MM/YYYY'), to_char(p_min_date, 'DD/MM/YYYY');
    end if;
    if v_prev is not null and v_date <= v_prev then
      raise exception 'Les dates des échéances doivent être strictement croissantes.';
    end if;
    v_prev := v_date;
    v_sum := v_sum + v_amount;
  end loop;

  if abs(v_sum - v_remaining) >= 1 then
    raise exception 'Le total des échéances (% F CFA) doit être égal au reste dû (% F CFA).',
      to_char(v_sum, 'FM999G999G999G990'), to_char(round(v_remaining), 'FM999G999G999G990');
  end if;

  -- Les échéances non soldées sont archivées (historique conservé) et leurs
  -- actions de retard closes ; les échéances déjà payées restent en place.
  update action_items set status = 'annulee', done_at = now(), done_by = auth.uid()
   where status = 'ouverte' and kind = 'echeance' and document_id = p_document_id
     and related_id in (select id from payment_installments
                         where document_id = p_document_id and replaced_at is null and status <> 'payee');
  update payment_installments set replaced_at = now(), replaced_by = auth.uid()
   where document_id = p_document_id and replaced_at is null and status <> 'payee';

  select coalesce(max(seq), 0) into v_seq from payment_installments where document_id = p_document_id;
  for v_item in select value from jsonb_array_elements(p_installments) loop
    v_seq := v_seq + 1;
    insert into payment_installments (organization_id, document_id, seq, due_date, amount, created_by)
    values (v_doc.organization_id, p_document_id, v_seq, (v_item ->> 'due_date')::date,
            (v_item ->> 'amount')::numeric, auth.uid());
  end loop;

  perform refresh_installments(p_document_id);
  return v_n;
end;
$$;

-- Droits de saisie : mêmes rôles que les policies d'insertion de payments
-- (payments_write + payments_write_temp_secretaire).
create or replace function public.can_record_payment(p_document_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from documents d
     where d.id = p_document_id
       and d.organization_id = auth_org_id()
       and (coalesce(auth_role()::text, '') in ('super_admin', 'administrateur', 'comptable', 'manager', 'receptionniste_sav')
            or d.commercial_id = auth.uid())
  );
$$;

-- 5. RPC : paiement (acompte) + échéancier ------------------------------------
create or replace function public.record_payment_with_schedule(
  p_document_id uuid,
  p_amount numeric,
  p_method text,
  p_date date default current_date,
  p_reference text default null,
  p_notes text default null,
  p_installments jsonb default null,
  p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_doc record;
  v_payment_id uuid;
  v_n int := 0;
  v_date date := coalesce(p_date, current_date);
begin
  if auth.uid() is null then raise exception 'Session expirée, reconnectez-vous.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;

  -- Idempotence : même demande renvoyée (double clic, réseau) => même résultat.
  if p_request_id is not null then
    select id into v_payment_id from payments where client_request_id = p_request_id;
    if v_payment_id is not null then
      return jsonb_build_object('payment_id', v_payment_id, 'duplicate', true,
        'installments', (select count(*) from payment_installments where document_id = p_document_id and replaced_at is null));
    end if;
  end if;

  select id, organization_id, client_id, document_type::text as document_type, status::text as status
    into v_doc from documents where id = p_document_id for update;
  if v_doc.id is null or not can_record_payment(p_document_id) then
    raise exception 'Vous n''avez pas le droit d''enregistrer un paiement sur ce document.';
  end if;
  if v_doc.status = 'annule' then
    raise exception 'Document annulé : aucun paiement possible.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Le montant doit être positif.';
  end if;
  if v_date > current_date then
    raise exception 'La date de paiement ne peut pas être dans le futur.';
  end if;
  if v_date < (current_date - interval '1 year')::date then
    raise exception 'La date de paiement ne peut pas remonter à plus d''un an.';
  end if;

  -- Insertion du paiement : tous les triggers existants s'appliquent
  -- (plafond, solde, notification, promotion du client, véhicules, affaires).
  insert into payments (organization_id, document_id, client_id, amount, payment_method, payment_date,
                        reference, notes, recorded_by, client_request_id)
  values (v_doc.organization_id, p_document_id, v_doc.client_id, p_amount, p_method::payment_method, v_date,
          nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), auth.uid(), p_request_id)
  returning id into v_payment_id;

  if p_installments is not null and jsonb_typeof(p_installments) = 'array'
     and jsonb_array_length(p_installments) > 0 then
    v_n := replace_installments(p_document_id, p_installments, v_date);
  end if;

  return jsonb_build_object('payment_id', v_payment_id, 'duplicate', false, 'installments', v_n,
    'balance_due', (select balance_due from documents where id = p_document_id));
end;
$$;

-- 6. RPC : modifier l'échéancier ----------------------------------------------
create or replace function public.set_payment_schedule(p_document_id uuid, p_installments jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_doc record;
begin
  if auth.uid() is null then raise exception 'Session expirée, reconnectez-vous.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;
  select id into v_doc from documents where id = p_document_id for update;
  if v_doc.id is null or not can_record_payment(p_document_id) then
    raise exception 'Vous n''avez pas le droit de modifier l''échéancier de ce document.';
  end if;
  return replace_installments(p_document_id, p_installments, current_date);
end;
$$;

-- 7. RPC : confirmer un paiement (comptable / direction) -------------------
create or replace function public.confirm_payment(p_payment_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pay record;
begin
  if auth.uid() is null then raise exception 'Session expirée, reconnectez-vous.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;
  if coalesce(auth_role()::text, '') not in ('comptable', 'super_admin', 'administrateur', 'manager') then
    raise exception 'Seule la comptable ou la direction peut confirmer un paiement.';
  end if;
  select id, document_id, organization_id, confirmed_at into v_pay from payments where id = p_payment_id for update;
  if v_pay.id is null or v_pay.organization_id is distinct from auth_org_id() then
    raise exception 'Paiement introuvable.';
  end if;
  if v_pay.confirmed_at is null then
    update payments set confirmed_at = now(), confirmed_by = auth.uid() where id = p_payment_id;
  end if;
  perform resolve_actions(v_pay.document_id, array['paiement_a_confirmer'], p_payment_id);
  return jsonb_build_object('payment_id', p_payment_id, 'already_confirmed', v_pay.confirmed_at is not null);
end;
$$;

-- 8. Rappels (cron, toutes les 10 min) --------------------------------------
-- J-3 : simple information (push_notification non urgente) au commercial et
--       aux comptables : rien à « traiter » tant que l'échéance n'est pas due.
-- Retard : action « echeance » (create_action, urgente, liée à l'échéance),
--       qui reste ouverte jusqu'au paiement (close par refresh_installments).
--       Au plus une tentative par jour ; create_action ne crée rien si une
--       action est déjà ouverte, donc pas de bruit tant qu'elle n'est pas
--       traitée. Si quelqu'un la clôt sans paiement, elle revient le
--       lendemain.
create or replace function public.generate_installment_reminders()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_targets uuid[];
  v_payload jsonb;
  v_before int := 0;
  v_overdue int := 0;
  v_status int := 0;
  v_user uuid;
  v_msg text;
begin
  -- Statuts : passage en retard des échéances non couvertes dont la date est passée.
  update payment_installments i set status = 'en_retard'
   where i.status = 'a_venir' and i.replaced_at is null and i.due_date < current_date;
  get diagnostics v_status = row_count;

  -- Rappel J-3 (une seule fois par échéance).
  for r in
    select i.*, d.document_number, d.commercial_id, d.organization_id as org
      from payment_installments i join documents d on d.id = i.document_id
     where i.status = 'a_venir' and i.replaced_at is null and i.reminded_before_at is null
       and i.due_date between current_date and current_date + 3
       and d.status::text not in ('paye', 'annule')
     for update of i skip locked
  loop
    select array_agg(distinct u) into v_targets from (
      select r.commercial_id as u where r.commercial_id is not null
      union select u from org_user_ids(r.org, array['comptable']) u
    ) t;
    v_msg := format('Échéance n° %s de %s : %s F CFA attendus le %s.',
                    r.seq, coalesce(r.document_number, 'une facture'),
                    to_char(round(r.amount - r.paid_amount), 'FM999G999G999G990'), to_char(r.due_date, 'DD/MM/YYYY'));
    v_payload := coalesce(document_mail_payload(r.document_id), '{}'::jsonb)
      || jsonb_build_object('installment_id', r.id, 'installment_seq', r.seq, 'installment_amount', r.amount - r.paid_amount,
                            'installment_due_date', r.due_date);
    foreach v_user in array coalesce(v_targets, '{}') loop
      perform push_notification(v_user, 'echeance_proche', 'Échéance proche', v_msg,
                                '/documents/' || r.document_id, r.document_id, false, 'echeance', v_payload, null);
    end loop;
    update payment_installments set reminded_before_at = now() where id = r.id;
    v_before := v_before + 1;
  end loop;

  -- Retard (au plus une fois par jour).
  for r in
    select i.*, d.document_number, d.commercial_id, d.organization_id as org
      from payment_installments i join documents d on d.id = i.document_id
     where i.status = 'en_retard' and i.replaced_at is null
       and (i.reminded_overdue_at is null or i.reminded_overdue_at < now() - interval '1 day')
       and d.status::text not in ('paye', 'annule')
     for update of i skip locked
  loop
    select array_agg(distinct u) into v_targets from (
      select r.commercial_id as u where r.commercial_id is not null
      union select u from org_user_ids(r.org, array['comptable']) u
    ) t;
    v_msg := format('Échéance n° %s de %s en retard : %s F CFA attendus le %s.',
                    r.seq, coalesce(r.document_number, 'une facture'),
                    to_char(round(r.amount - r.paid_amount), 'FM999G999G999G990'), to_char(r.due_date, 'DD/MM/YYYY'));
    v_payload := coalesce(document_mail_payload(r.document_id), '{}'::jsonb)
      || jsonb_build_object('installment_id', r.id, 'installment_seq', r.seq, 'installment_amount', r.amount - r.paid_amount,
                            'installment_due_date', r.due_date);
    perform create_action('echeance', v_targets, 'Échéance en retard', v_msg,
                          '/documents/' || r.document_id, r.document_id, r.id, v_payload);
    update payment_installments set reminded_overdue_at = now() where id = r.id;
    v_overdue := v_overdue + 1;
  end loop;

  return jsonb_build_object('statuts_en_retard', v_status, 'rappels_avant', v_before, 'rappels_retard', v_overdue);
end;
$$;

-- 9. Droits -------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.refresh_installments(uuid)',
    'public.installments_on_payment()',
    'public.payments_confirmation_defaults()',
    'public.payments_request_confirmation()',
    'public.replace_installments(uuid, jsonb, date)',
    'public.can_record_payment(uuid)',
    'public.generate_installment_reminders()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;
grant execute on function public.generate_installment_reminders() to service_role;

revoke all on function public.record_payment_with_schedule(uuid, numeric, text, date, text, text, jsonb, uuid) from public, anon;
revoke all on function public.set_payment_schedule(uuid, jsonb) from public, anon;
revoke all on function public.confirm_payment(uuid) from public, anon;
grant execute on function public.record_payment_with_schedule(uuid, numeric, text, date, text, text, jsonb, uuid) to authenticated;
grant execute on function public.set_payment_schedule(uuid, jsonb) to authenticated;
grant execute on function public.confirm_payment(uuid) to authenticated;
