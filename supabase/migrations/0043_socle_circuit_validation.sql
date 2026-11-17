-- =============================================================================
-- 0043 : Socle commun des demandes de la direction (réunion du 16/11/2026)
--
-- Ce fichier pose uniquement les fondations partagées ; chaque étape a
-- ensuite sa propre migration (0044 circuit de vente, 0045 paiements, 0046
-- fiche client, 0047 réception SAV, 0048 objectifs, 0049 notifications).
--
--   1. Rôle « responsable_commercial » (N+1 qui valide les proformas).
--   2. Statut de circuit (workflow_status) sur les documents, séparé du
--      statut de paiement existant (status) pour ne rien casser.
--      Proforma (type interne « devis ») : brouillon, en_attente_validation,
--        validee, refusee, envoyee, acceptee
--      Bon de commande (« commande ») : a_verifier, conforme, non_conforme,
--        facture_en_attente_validation, facture
--      Facture : en_preparation, en_attente_validation, validee, refusee, emise
--   3. Signature N+1, auteur et date de validation.
--   4. Numéro moteur des véhicules, banque du client, choix des e-mails.
--   5. Actions à valider (action_items) + file d'envoi des e-mails
--      (email_outbox) + fonctions communes pour notifier.
-- =============================================================================

-- 1. Rôle (ajouté seul : une valeur d'enum ne s'utilise pas dans la même
--    transaction que sa création).
alter type public.user_role add value if not exists 'responsable_commercial';

-- =============================================================================
-- 2 à 5 (appliqué séparément, après le commit de la valeur d'enum)
-- =============================================================================

-- 2-3. Circuit sur les documents
alter table public.documents
  add column if not exists workflow_status text,
  add column if not exists workflow_reason text,
  add column if not exists workflow_changed_at timestamptz,
  add column if not exists workflow_changed_by uuid references public.profiles(id),
  add column if not exists submitted_by uuid references public.profiles(id),
  add column if not exists submitted_at timestamptz,
  add column if not exists validated_by uuid references public.profiles(id),
  add column if not exists validated_at timestamptz,
  add column if not exists n1_signature_url text,
  add column if not exists n1_signed_by uuid references public.profiles(id),
  add column if not exists n1_signed_at timestamptz;

alter table public.documents add constraint documents_workflow_status_check check (
  workflow_status is null
  or document_type::text in ('devis', 'proforma') and workflow_status in
     ('brouillon', 'en_attente_validation', 'validee', 'refusee', 'envoyee', 'acceptee')
  or document_type::text = 'commande' and workflow_status in
     ('a_verifier', 'conforme', 'non_conforme', 'facture_en_attente_validation', 'facture')
  or document_type::text = 'facture' and workflow_status in
     ('en_preparation', 'en_attente_validation', 'validee', 'refusee', 'emise')
  or document_type::text not in ('devis', 'proforma', 'commande', 'facture')
);
create index if not exists documents_workflow_idx on public.documents (organization_id, document_type, workflow_status);

-- Documents déjà existants : on reprend leur statut actuel, sans rien bloquer.
do $$
begin
  perform set_config('app.doc_guard_bypass', 'on', true);
  update public.documents d set workflow_status = case
      when d.document_type::text in ('devis', 'proforma') then case d.status::text
        when 'brouillon' then 'brouillon' when 'refuse' then 'refusee'
        when 'accepte' then 'acceptee' when 'annule' then 'refusee' else 'envoyee' end
      when d.document_type::text = 'commande' then case
        when exists (select 1 from public.documents f where f.parent_document_id = d.id
                      and f.document_type::text = 'facture' and f.status::text <> 'annule') then 'facture'
        else 'conforme' end
      when d.document_type::text = 'facture' then 'emise'
    end
   where d.workflow_status is null and d.document_type::text in ('devis', 'proforma', 'commande', 'facture');
end;
$$;

-- 4. Véhicules, clients, réglages e-mail
alter table public.vehicle_units add column if not exists engine_number text;
create unique index if not exists vehicle_units_engine_number_uniq
  on public.vehicle_units (organization_id, engine_number) where engine_number is not null;
alter table public.clients add column if not exists bank_name text;
alter table public.profiles add column if not exists email_non_urgent boolean not null default true;
alter table public.notifications add column if not exists link text;
alter table public.notifications add column if not exists action_item_id uuid;

-- 5a. Actions en attente (une ligne par destinataire)
create table if not exists public.action_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assignee_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,               -- proforma_a_valider, commande_a_verifier, facture_a_valider,
                                    -- facture_a_emettre, paiement_a_confirmer, echeance, compte_a_creer...
  title text not null,
  message text,
  link text,                        -- chemin interne, ex. /documents/<id>
  document_id uuid references public.documents(id) on delete cascade,
  related_id uuid,                  -- autre objet lié (échéance, demande de compte...)
  requested_by uuid references public.profiles(id),
  payload jsonb not null default '{}'::jsonb,  -- client, montant, numéro... pour l'e-mail
  status text not null default 'ouverte' check (status in ('ouverte', 'traitee', 'annulee')),
  created_at timestamptz not null default now(),
  reminded_at timestamptz,          -- rappel 24 h envoyé
  escalated_at timestamptz,         -- copie direction 48 h envoyée
  done_at timestamptz,
  done_by uuid references public.profiles(id)
);
create index if not exists action_items_open_idx on public.action_items (assignee_id, status, created_at);
create index if not exists action_items_doc_idx on public.action_items (document_id, kind) where status = 'ouverte';
alter table public.action_items enable row level security;
create policy action_items_select on public.action_items for select to authenticated using (
  organization_id = auth_org_id()
  and (assignee_id = auth.uid()
       or coalesce(auth_role()::text, '') in ('super_admin', 'administrateur', 'manager'))
);
create policy mfa_required on public.action_items as restrictive for all to authenticated
  using ((select mfa_satisfied()));
-- Aucune écriture directe : uniquement par les fonctions ci-dessous.

-- 5b. File d'envoi des e-mails (lue et écrite uniquement côté serveur)
create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  to_user_id uuid references public.profiles(id) on delete set null,
  to_email text not null,
  cc_emails text[] not null default '{}',
  category text not null check (category in ('validation', 'info', 'rappel', 'recapitulatif')),
  template text not null,           -- nom du modèle d'e-mail côté application
  payload jsonb not null default '{}'::jsonb,
  action_item_id uuid references public.action_items(id) on delete set null,
  status text not null default 'en_attente' check (status in ('en_attente', 'envoye', 'echec', 'ignore')),
  attempts int not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_id text,
  created_at timestamptz not null default now()
);
create index if not exists email_outbox_pending_idx on public.email_outbox (status, next_attempt_at);
alter table public.email_outbox enable row level security;
-- Pas de policy : seul le serveur (clé service_role) y accède.

-- 5c. Fonctions communes (appelées par les fonctions métier SECURITY DEFINER)
create or replace function public.org_user_ids(p_org uuid, p_roles text[])
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from profiles p
   where p.organization_id = p_org and p.is_active
     and p.role::text = any (p_roles);
$$;

-- Notification dans la cloche + e-mail mis en file.
-- p_urgent = true : demande de validation, jamais coupée par l'utilisateur.
create or replace function public.push_notification(
  p_user uuid, p_type text, p_title text, p_message text, p_link text,
  p_document uuid default null, p_urgent boolean default false,
  p_template text default 'info', p_payload jsonb default '{}'::jsonb,
  p_action uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_email text; v_opt boolean;
begin
  select organization_id, email, email_non_urgent into v_org, v_email, v_opt
    from profiles where id = p_user and is_active;
  if v_org is null then return; end if;
  insert into notifications (organization_id, user_id, type, title, message, related_document_id, link, action_item_id)
  values (v_org, p_user, p_type, p_title, p_message, p_document, p_link, p_action);
  if v_email is not null and v_email <> '' and (p_urgent or v_opt) then
    insert into email_outbox (organization_id, to_user_id, to_email, category, template, payload, action_item_id)
    values (v_org, p_user, v_email, case when p_urgent then 'validation' else 'info' end, p_template,
            p_payload || jsonb_build_object('title', p_title, 'message', p_message, 'link', p_link), p_action);
  end if;
end;
$$;

-- Crée une action à traiter pour chaque destinataire (et la notifie).
create or replace function public.create_action(
  p_kind text, p_assignees uuid[], p_title text, p_message text, p_link text,
  p_document uuid default null, p_related uuid default null, p_payload jsonb default '{}'::jsonb
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_user uuid; v_org uuid; v_id uuid; v_n int := 0;
begin
  foreach v_user in array coalesce(p_assignees, '{}') loop
    select organization_id into v_org from profiles where id = v_user and is_active;
    continue when v_org is null;
    -- pas de doublon : une seule action ouverte par (destinataire, type, objet)
    if exists (select 1 from action_items where assignee_id = v_user and kind = p_kind and status = 'ouverte'
                 and coalesce(document_id, '00000000-0000-0000-0000-000000000000') = coalesce(p_document, '00000000-0000-0000-0000-000000000000')
                 and coalesce(related_id, '00000000-0000-0000-0000-000000000000') = coalesce(p_related, '00000000-0000-0000-0000-000000000000')) then
      continue;
    end if;
    insert into action_items (organization_id, assignee_id, kind, title, message, link, document_id, related_id, requested_by, payload)
    values (v_org, v_user, p_kind, p_title, p_message, p_link, p_document, p_related, auth.uid(), p_payload)
    returning id into v_id;
    perform push_notification(v_user, p_kind, p_title, p_message, p_link, p_document, true, 'action', p_payload, v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Clôt les actions ouvertes d'un objet (document ou objet lié) pour ces types.
create or replace function public.resolve_actions(p_document uuid, p_kinds text[], p_related uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update action_items set status = 'traitee', done_at = now(), done_by = auth.uid()
   where status = 'ouverte' and kind = any (p_kinds)
     and (p_document is null or document_id = p_document)
     and (p_related is null or related_id = p_related);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Données d'un document utiles aux e-mails (numéro, client, montant, demandeur).
create or replace function public.document_mail_payload(p_document uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'document_id', d.id,
    'document_type', d.document_type::text,
    'document_number', d.document_number,
    'client', coalesce(nullif(c.company_name, ''), trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''))),
    'amount', d.total_amount,
    'requester', (select full_name from profiles where id = auth.uid())
  )
  from documents d left join clients c on c.id = d.client_id
  where d.id = p_document;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.org_user_ids(uuid, text[])',
    'public.push_notification(uuid, text, text, text, text, uuid, boolean, text, jsonb, uuid)',
    'public.create_action(text, uuid[], text, text, text, uuid, uuid, jsonb)',
    'public.resolve_actions(uuid, text[], uuid)',
    'public.document_mail_payload(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;

-- Rôles qui valident
create or replace function public.is_direction() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role()::text, '') in ('super_admin', 'administrateur', 'manager');
$$;
create or replace function public.is_proforma_validator() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role()::text, '') in ('super_admin', 'administrateur', 'manager', 'responsable_commercial');
$$;
create or replace function public.is_adv() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role()::text, '') in ('admin_ventes', 'super_admin');
$$;
revoke all on function public.is_direction() from public, anon;
revoke all on function public.is_proforma_validator() from public, anon;
revoke all on function public.is_adv() from public, anon;
grant execute on function public.is_direction() to authenticated;
grant execute on function public.is_proforma_validator() to authenticated;
grant execute on function public.is_adv() to authenticated;
