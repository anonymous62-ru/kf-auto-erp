-- =============================================================================
-- 0049 : Notifications des actions à valider (étape 9)
--
--   1. Rappels : 24 h sans traitement -> rappel au destinataire ;
--      48 h -> nouveau rappel avec la direction (DG + manager) en copie.
--   2. Récapitulatif quotidien (7 h, heure de Lomé) des actions en attente.
--   3. Fonction chapeau appelée par pg_cron toutes les 10 minutes, qui
--      déclenche aussi les rappels d'échéances (generate_installment_reminders,
--      migration 0045) si cette fonction existe.
--   4. Appel HTTP (pg_net) de la route /api/cron/notifications, qui envoie les
--      e-mails en file via Resend. Secret lu dans Supabase Vault ('cron_secret').
--   5. Demande de création de compte : action 'compte_a_creer' pour le DG et
--      le manager, close automatiquement quand la demande est traitée.
--   6. Journal d'audit : chaque e-mail envoyé (ou en échec définitif).
--   7. Compteur des actions en attente pour l'application.
--
-- Rien ici n'envoie d'e-mail directement : la base met en file
-- (email_outbox), l'application envoie.
-- =============================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Membres de la direction qui reçoivent les escalades (DG + manager).
create or replace function public.direction_emails(p_org uuid, p_exclude uuid default null)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct p.email), '{}')
    from profiles p
   where p.organization_id = p_org and p.is_active
     and p.role::text in ('administrateur', 'manager')
     and p.email is not null and p.email <> ''
     and (p_exclude is null or p.id <> p_exclude);
$$;

-- -----------------------------------------------------------------------------
-- 1. Rappels 24 h / 48 h (idempotent : reminded_at / escalated_at)
-- -----------------------------------------------------------------------------
create or replace function public.process_action_reminders()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a record;
  v_cc text[];
  v_dir uuid;
  v_payload jsonb;
  v_rappels int := 0;
  v_escalades int := 0;
begin
  -- Une seule exécution à la fois (deux passages cron qui se chevauchent).
  if not pg_try_advisory_xact_lock(hashtext('kf_process_action_reminders')) then
    return jsonb_build_object('ignore', 'execution deja en cours');
  end if;

  -- 48 h : rappel au destinataire, direction en copie + notification direction.
  for a in
    select ai.*, p.email as assignee_email, p.is_active as assignee_active, p.full_name as assignee_name
      from action_items ai join profiles p on p.id = ai.assignee_id
     where ai.status = 'ouverte' and ai.escalated_at is null
       and ai.created_at <= now() - interval '48 hours'
     order by ai.created_at
     for update of ai skip locked
  loop
    v_cc := direction_emails(a.organization_id, a.assignee_id);
    if a.assignee_email is not null then
      v_cc := array_remove(v_cc, a.assignee_email);
    end if;
    v_payload := a.payload || jsonb_build_object(
      'title', a.title, 'message', a.message, 'link', a.link, 'kind', a.kind,
      'created_at', a.created_at, 'escalated', true, 'assignee', a.assignee_name,
      'requested_by_name', (select full_name from profiles where id = a.requested_by));

    if a.assignee_active and coalesce(a.assignee_email, '') <> '' then
      insert into email_outbox (organization_id, to_user_id, to_email, cc_emails, category, template, payload, action_item_id)
      values (a.organization_id, a.assignee_id, a.assignee_email, v_cc, 'rappel', 'rappel', v_payload, a.id);
      insert into notifications (organization_id, user_id, type, title, message, related_document_id, link, action_item_id)
      values (a.organization_id, a.assignee_id, 'rappel', 'Rappel : ' || a.title,
              'En attente depuis plus de 48 h. La direction a été mise en copie.', a.document_id, a.link, a.id);
    elsif array_length(v_cc, 1) > 0 then
      -- Destinataire désactivé ou sans e-mail : la direction reçoit directement.
      insert into email_outbox (organization_id, to_user_id, to_email, cc_emails, category, template, payload, action_item_id)
      values (a.organization_id, null, v_cc[1], v_cc[2:], 'rappel', 'rappel', v_payload, a.id);
    end if;

    for v_dir in
      select p.id from profiles p
       where p.organization_id = a.organization_id and p.is_active
         and p.role::text in ('administrateur', 'manager') and p.id <> a.assignee_id
    loop
      insert into notifications (organization_id, user_id, type, title, message, related_document_id, link, action_item_id)
      values (a.organization_id, v_dir, 'escalade', 'En attente depuis 48 h : ' || a.title,
              format('Action de %s non traitée depuis plus de 48 h.', coalesce(a.assignee_name, 'un utilisateur')),
              a.document_id, a.link, a.id);
    end loop;

    update action_items set escalated_at = now(), reminded_at = coalesce(reminded_at, now()) where id = a.id;
    v_escalades := v_escalades + 1;
  end loop;

  -- 24 h : rappel au même destinataire.
  for a in
    select ai.*, p.email as assignee_email, p.full_name as assignee_name
      from action_items ai join profiles p on p.id = ai.assignee_id
     where ai.status = 'ouverte' and ai.reminded_at is null
       and ai.created_at <= now() - interval '24 hours'
       and p.is_active
     order by ai.created_at
     for update of ai skip locked
  loop
    insert into notifications (organization_id, user_id, type, title, message, related_document_id, link, action_item_id)
    values (a.organization_id, a.assignee_id, 'rappel', 'Rappel : ' || a.title,
            'En attente depuis plus de 24 h.', a.document_id, a.link, a.id);
    if coalesce(a.assignee_email, '') <> '' then
      insert into email_outbox (organization_id, to_user_id, to_email, category, template, payload, action_item_id)
      values (a.organization_id, a.assignee_id, a.assignee_email, 'rappel', 'rappel',
              a.payload || jsonb_build_object(
                'title', a.title, 'message', a.message, 'link', a.link, 'kind', a.kind,
                'created_at', a.created_at, 'escalated', false,
                'requested_by_name', (select full_name from profiles where id = a.requested_by)),
              a.id);
    end if;
    update action_items set reminded_at = now() where id = a.id;
    v_rappels := v_rappels + 1;
  end loop;

  return jsonb_build_object('rappels', v_rappels, 'escalades', v_escalades);
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Récapitulatif quotidien (une fois par jour et par personne)
-- -----------------------------------------------------------------------------
create or replace function public.queue_daily_digests()
returns int language plpgsql security definer set search_path = public as $$
declare
  u record;
  v_today date := (now() at time zone 'Africa/Lome')::date;
  v_items jsonb;
  v_count int;
  v_n int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('kf_queue_daily_digests')) then
    return 0;
  end if;
  for u in
    select distinct p.id, p.organization_id, p.email, p.full_name
      from profiles p join action_items ai on ai.assignee_id = p.id and ai.status = 'ouverte'
     where p.is_active and coalesce(p.email, '') <> ''
  loop
    -- garde par date : déjà mis en file aujourd'hui ?
    continue when exists (
      select 1 from email_outbox e
       where e.to_user_id = u.id and e.category = 'recapitulatif'
         and (e.created_at at time zone 'Africa/Lome')::date = v_today);

    select count(*) into v_count from action_items where assignee_id = u.id and status = 'ouverte';
    select coalesce(jsonb_agg(x.item order by x.created_at), '[]'::jsonb) into v_items
      from (
        select ai.created_at, jsonb_build_object(
                 'title', ai.title, 'link', ai.link, 'kind', ai.kind,
                 'created_at', ai.created_at,
                 'age_hours', floor(extract(epoch from now() - ai.created_at) / 3600)::int,
                 'document_number', ai.payload->>'document_number',
                 'client', ai.payload->>'client',
                 'amount', ai.payload->'amount') as item
          from action_items ai
         where ai.assignee_id = u.id and ai.status = 'ouverte'
         order by ai.created_at
         limit 50
      ) x;

    insert into email_outbox (organization_id, to_user_id, to_email, category, template, payload)
    values (u.organization_id, u.id, u.email, 'recapitulatif', 'recapitulatif',
            jsonb_build_object('title', 'Vos actions en attente', 'link', '/actions',
                               'name', u.full_name, 'count', v_count, 'date', v_today, 'items', v_items));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Fonction chapeau (cron toutes les 10 minutes)
-- -----------------------------------------------------------------------------
create or replace function public.run_scheduled_notifications()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_result jsonb := '{}'::jsonb;
begin
  begin
    v_result := v_result || jsonb_build_object('actions', process_action_reminders());
  exception when others then
    v_result := v_result || jsonb_build_object('actions_erreur', sqlerrm);
  end;
  if to_regprocedure('public.generate_installment_reminders()') is not null then
    begin
      execute 'select public.generate_installment_reminders()';
      v_result := v_result || jsonb_build_object('echeances', 'ok');
    exception when others then
      v_result := v_result || jsonb_build_object('echeances_erreur', sqlerrm);
    end;
  end if;
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Appel de la route d'envoi (seulement s'il y a des e-mails à envoyer)
-- -----------------------------------------------------------------------------
create or replace function public.call_notifications_endpoint()
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare
  v_secret text;
  v_id bigint;
begin
  if not exists (select 1 from email_outbox where status = 'en_attente' and next_attempt_at <= now()) then
    return null;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  if v_secret is null then
    return null;
  end if;
  -- pg_net est asynchrone : une URL injoignable n'interrompt pas le job.
  select net.http_post(
    url := 'https://kf-auto-erp.vercel.app/api/cron/notifications',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    timeout_milliseconds := 30000
  ) into v_id;
  return v_id;
exception when others then
  raise warning 'call_notifications_endpoint: %', sqlerrm;
  return null;
end;
$$;

-- Secret partagé avec Vercel (CRON_SECRET), généré ici, jamais écrit en clair
-- dans le dépôt.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cron_secret',
                                'Secret de la route /api/cron/notifications (Vercel CRON_SECRET)');
  end if;
end;
$$;

-- Planification (cron.schedule remplace un job existant du même nom).
select cron.schedule('kf-notifications-10min', '*/10 * * * *',
  $c$select public.run_scheduled_notifications(); select public.call_notifications_endpoint();$c$);
-- 7 h 00 à Lomé = 7 h 00 UTC (pas d'heure d'été au Togo).
select cron.schedule('kf-recapitulatif-quotidien', '0 7 * * *',
  $c$select public.queue_daily_digests(); select public.call_notifications_endpoint();$c$);

-- -----------------------------------------------------------------------------
-- 5. Demande de création de compte -> action pour le DG et le manager
-- -----------------------------------------------------------------------------
create or replace function public.notify_user_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user record;
  v_by text;
  v_targets uuid[];
begin
  select full_name into v_by from profiles where id = new.requested_by;

  -- DG (administrateur) et manager : action à traiter (cloche + e-mail).
  select coalesce(array_agg(id), '{}') into v_targets from profiles
   where organization_id = new.organization_id and is_active
     and role::text in ('administrateur', 'manager') and id <> new.requested_by;
  perform create_action(
    'compte_a_creer', v_targets, 'Demande de création de compte',
    format('%s demande un compte pour %s.', coalesce(v_by, 'Un chef de service'), new.full_name),
    '/users/demandes', null, new.id,
    jsonb_build_object('document_type', 'compte', 'document_number', new.full_name,
                       'requester', v_by, 'role', new.role::text, 'department', new.department));

  -- Autres validateurs (super admin) : simple notification, comme avant.
  for v_user in
    select id from profiles
     where organization_id = new.organization_id and is_active
       and role::text = 'super_admin' and id <> new.requested_by
  loop
    insert into notifications (organization_id, user_id, type, title, message, link)
    values (new.organization_id, v_user.id, 'demande_inscription', 'Demande d''inscription',
            format('%s demande un compte pour %s.', coalesce(v_by, 'Un chef de service'), new.full_name),
            '/users/demandes');
  end loop;
  return new;
end;
$$;

create or replace function public.resolve_user_request_actions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'en_attente' and new.status <> 'en_attente' then
    perform resolve_actions(null, array['compte_a_creer'], new.id);
  end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_resolve_user_request_actions') then
    create trigger trg_resolve_user_request_actions after update of status on public.user_requests
      for each row execute function public.resolve_user_request_actions();
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 6. Journal d'audit des e-mails (un seul endroit : changement de statut)
-- -----------------------------------------------------------------------------
create or replace function public.audit_email_outbox()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('envoye', 'echec') and new.status is distinct from old.status then
    insert into audit_log (organization_id, user_id, table_name, record_id, action, old_data, new_data)
    values (new.organization_id, null, 'email_outbox', new.id, 'insert', null,
            jsonb_build_object(
              'destinataire', new.to_email,
              'copie', new.cc_emails,
              'categorie', new.category,
              'modele', new.template,
              'statut', new.status,
              'sujet', coalesce(new.payload->>'subject', new.payload->>'title'),
              'tentatives', new.attempts,
              'erreur', new.last_error,
              'fournisseur_id', new.provider_id,
              'action_id', new.action_item_id));
  end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_audit_email_outbox') then
    create trigger trg_audit_email_outbox after update of status on public.email_outbox
      for each row execute function public.audit_email_outbox();
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Compteur pour l'application
-- -----------------------------------------------------------------------------
create or replace function public.my_pending_actions_count()
returns int language sql stable security invoker set search_path = public as $$
  select count(*)::int from action_items where assignee_id = auth.uid() and status = 'ouverte';
$$;

-- Droits : fonctions internes réservées au serveur (postgres / service_role).
do $$
declare f text;
begin
  foreach f in array array[
    'public.direction_emails(uuid, uuid)',
    'public.process_action_reminders()',
    'public.queue_daily_digests()',
    'public.run_scheduled_notifications()',
    'public.call_notifications_endpoint()',
    'public.resolve_user_request_actions()',
    'public.audit_email_outbox()',
    'public.notify_user_request()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
revoke all on function public.my_pending_actions_count() from public, anon;
grant execute on function public.my_pending_actions_count() to authenticated;
