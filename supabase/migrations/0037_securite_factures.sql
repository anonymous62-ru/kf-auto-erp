-- =============================================================================
-- 0037 : Sécurité des factures (direction, 10/10/2026)
--
-- 1. Une facture (ou un avoir) émise, c'est-à-dire dont le statut n'est plus
--    « brouillon », ne peut plus être modifiée par personne : ni lignes, ni
--    montants, ni client, ni dates, ni châssis. Seuls les champs de suivi
--    bougent encore (paiements, relances, signature manquante).
-- 2. Une facture ne se supprime jamais (numérotation sans trou) :
--      - brouillon erroné : « Annuler la facture » (cancel_draft_invoice) ;
--      - facture émise : correction uniquement par AVOIR (create_avoir),
--        réservé à l'administration des ventes et à la direction.
-- 3. Le numéro des factures et avoirs est attribué dans la même transaction
--    que l'enregistrement du document (trigger), et la fonction de
--    numérotation n'est plus appelable directement pour ces deux types :
--    un numéro ne peut plus être « consommé » sans document.
-- 4. Historique lisible par document (document_history), en plus du journal
--    d'audit technique (audit_log) qui garde l'état complet avant/après.
--
-- Contexte « purge » : seul un administrateur de la base, dans l'éditeur SQL
-- de Supabase (rôle postgres, sans session utilisateur), peut encore retirer
-- des données de test. Aucune requête venant de l'application n'y a accès.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Volontairement SANS security definer : current_user doit rester celui de la
-- requête (authenticated / service_role depuis l'application).
create or replace function public.doc_lock_purge_context()
returns boolean language sql stable as $$
  select auth.uid() is null and current_user in ('postgres', 'supabase_admin');
$$;

-- Lecture du type et du statut d'un document sans dépendre des droits RLS de
-- l'appelant (utilisée par les triggers de verrouillage).
create or replace function public.document_lock_state(p_document_id uuid)
returns table (document_type text, status text)
language sql stable security definer set search_path = public as $$
  select d.document_type::text, d.status::text from documents d where d.id = p_document_id;
$$;
revoke all on function public.document_lock_state(uuid) from public, anon;
grant execute on function public.document_lock_state(uuid) to authenticated;

-- Rôles qui peuvent préparer (brouillon) une facture : facturation véhicules
-- et facturation atelier. Les commerciaux n'en font pas partie.
create or replace function public.is_invoice_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth_role()::text, '') in
    ('super_admin', 'administrateur', 'manager', 'admin_ventes', 'comptable', 'receptionniste_sav', 'chef_atelier');
$$;
revoke all on function public.is_invoice_editor() from public, anon;
grant execute on function public.is_invoice_editor() to authenticated;

-- Avoirs et annulations : administration des ventes et direction uniquement.
create or replace function public.is_credit_note_issuer()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth_role()::text, '') in ('super_admin', 'administrateur', 'manager', 'admin_ventes');
$$;
revoke all on function public.is_credit_note_issuer() from public, anon;
grant execute on function public.is_credit_note_issuer() to authenticated;

-- ---------------------------------------------------------------------------
-- Historique lisible des documents
-- ---------------------------------------------------------------------------
create table if not exists public.document_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  event text not null,
  message text not null,
  user_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_document_history_document on public.document_history (document_id, created_at);

alter table public.document_history enable row level security;

drop policy if exists document_history_select on public.document_history;
create policy document_history_select on public.document_history
  for select to authenticated
  using (
    organization_id = auth_org_id()
    and exists (select 1 from documents d where d.id = document_history.document_id)
  );

drop policy if exists mfa_required on public.document_history;
create policy mfa_required on public.document_history
  as restrictive for all to authenticated
  using ((select mfa_satisfied())) with check ((select mfa_satisfied()));

-- Pas de policy insert/update/delete : écrit uniquement par les triggers et
-- fonctions ci-dessous. Lignes non modifiables.
revoke insert, update, delete on public.document_history from anon, authenticated;

create or replace function public.document_label(p_type text)
returns text language sql immutable as $$
  select case p_type
    when 'devis' then 'Facture proforma'
    when 'proforma' then 'Proforma'
    when 'commande' then 'Commande'
    when 'facture' then 'Facture'
    when 'avoir' then 'Avoir'
    when 'bon_livraison' then 'Bon de livraison'
    when 'recu' then 'Reçu'
    else 'Document'
  end;
$$;

create or replace function public.log_document_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_label text := document_label(new.document_type::text);
  v_event text;
  v_message text;
begin
  if tg_op = 'INSERT' then
    v_event := 'creation';
    v_message := v_label || ' ' || coalesce(new.document_number, '') || ' créée';
    if new.document_type::text = 'avoir' then
      v_message := 'Avoir ' || coalesce(new.document_number, '') || ' créé';
    elsif new.document_type::text in ('bon_livraison', 'recu') then
      v_message := v_label || ' ' || coalesce(new.document_number, '') || ' créé';
    end if;
  elsif new.status is distinct from old.status then
    if new.status::text = 'annule' then
      v_event := 'annulation';
      v_message := v_label || ' annulée';
      if new.document_type::text = 'avoir' then v_message := 'Avoir annulé'; end if;
    elsif new.status::text in ('paye', 'paye_partiel') then
      v_event := 'paiement';
      v_message := case when new.status::text = 'paye' then 'Entièrement payée' else 'Paiement partiel enregistré' end;
    elsif old.status::text = 'brouillon' and new.document_type::text in ('facture', 'avoir') then
      v_event := 'emission';
      v_message := case when new.document_type::text = 'avoir' then 'Avoir émis : il ne peut plus être modifié'
                        else 'Facture émise : elle ne peut plus être modifiée' end;
    elsif new.status::text = 'envoye' then
      v_event := 'envoi';
      v_message := 'Envoyée au client';
    elsif new.status::text = 'accepte' then
      v_event := 'conversion';
      v_message := case new.document_type::text when 'commande' then 'Facturée' else 'Passée en commande' end;
    elsif new.status::text = 'brouillon' then
      v_event := 'reouverture';
      v_message := case when new.document_type::text = 'commande' then 'De nouveau à facturer' else 'Repassée en brouillon' end;
    elsif new.status::text = 'refuse' then
      v_event := 'refus';
      v_message := 'Refusée par le client';
    else
      return null;
    end if;
  else
    return null;
  end if;

  insert into document_history (organization_id, document_id, event, message, user_id)
  values (new.organization_id, new.id, v_event, v_message, auth.uid());
  return null;
end;
$$;

drop trigger if exists trg_log_document_history on public.documents;
create trigger trg_log_document_history
  after insert or update of status on public.documents
  for each row execute function public.log_document_history();

-- Événement libre ajouté par les fonctions de confiance (avoir, motif...).
create or replace function public.add_document_history(p_document_id uuid, p_event text, p_message text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into document_history (organization_id, document_id, event, message, user_id)
  select d.organization_id, d.id, p_event, p_message, auth.uid() from documents d where d.id = p_document_id;
end;
$$;
revoke all on function public.add_document_history(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verrou des factures et avoirs (documents)
-- ---------------------------------------------------------------------------
create or replace function public.lock_issued_invoices()
returns trigger language plpgsql as $$
declare
  -- Champs de suivi qui peuvent encore bouger sur une facture émise.
  v_tracking text[] := array['status', 'amount_paid', 'balance_due', 'updated_at', 'last_reminder_at',
                             'pdf_url', 'synced_at', 'commercial_signature_url', 'client_signature_url', 'signed_at'];
  v_trusted boolean := pg_trigger_depth() > 1
                       or coalesce(current_setting('app.doc_guard_bypass', true), '') = 'on'
                       or coalesce(current_setting('app.avoir_flow', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    if old.document_type::text in ('facture', 'avoir') and not doc_lock_purge_context() then
      raise exception 'Une facture ou un avoir ne se supprime jamais (numérotation officielle). Annulez le brouillon ou établissez un avoir.';
    end if;
    return old;
  end if;

  if old.document_type::text not in ('facture', 'avoir') or doc_lock_purge_context() then
    return new;
  end if;

  -- Brouillon : seuls les rôles de facturation (ou une fonction de confiance)
  -- le préparent. Un commercial ne touche pas à une facture.
  if old.status::text = 'brouillon' then
    if not v_trusted and not is_invoice_editor()
       and (to_jsonb(new) - v_tracking) is distinct from (to_jsonb(old) - v_tracking) then
      raise exception 'Seule l''administration des ventes peut modifier une facture.';
    end if;
    if new.status::text in ('annule', 'refuse', 'accepte') and not v_trusted then
      raise exception 'Une facture en brouillon s''annule avec le bouton « Annuler la facture ».';
    end if;
    return new;
  end if;

  -- Facture émise : contenu figé pour tout le monde.
  if (to_jsonb(new) - v_tracking) is distinct from (to_jsonb(old) - v_tracking) then
    raise exception 'Cette facture est émise : elle ne peut plus être modifiée. Corrigez-la par un avoir.';
  end if;
  if old.commercial_signature_url is not null and new.commercial_signature_url is distinct from old.commercial_signature_url
     or old.client_signature_url is not null and new.client_signature_url is distinct from old.client_signature_url
     or old.signed_at is not null and new.signed_at is distinct from old.signed_at then
    raise exception 'La signature d''une facture émise ne peut pas être remplacée.';
  end if;
  if new.status::text = 'brouillon' then
    raise exception 'Une facture émise ne peut pas repasser en brouillon.';
  end if;
  if old.status::text = 'annule' and new.status::text <> 'annule' then
    raise exception 'Une facture annulée le reste.';
  end if;
  if new.status::text = 'annule' and old.status::text <> 'annule'
     and coalesce(current_setting('app.avoir_flow', true), '') <> 'on' then
    raise exception 'Une facture émise s''annule uniquement par un avoir.';
  end if;
  if new.status::text in ('accepte', 'refuse') and new.status is distinct from old.status then
    raise exception 'Statut non autorisé pour une facture émise.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lock_issued_invoices on public.documents;
create trigger trg_lock_issued_invoices
  before update or delete on public.documents
  for each row execute function public.lock_issued_invoices();

-- ---------------------------------------------------------------------------
-- Verrou des lignes et des châssis
-- ---------------------------------------------------------------------------
create or replace function public.lock_issued_invoice_children()
returns trigger language plpgsql as $$
declare
  v_doc_id uuid := case when tg_op = 'DELETE' then old.document_id else new.document_id end;
  v_type text;
  v_status text;
  v_trusted boolean := pg_trigger_depth() > 1
                       or coalesce(current_setting('app.doc_guard_bypass', true), '') = 'on'
                       or coalesce(current_setting('app.avoir_flow', true), '') = 'on';
begin
  if doc_lock_purge_context() then
    return coalesce(new, old);
  end if;
  select s.document_type, s.status into v_type, v_status from document_lock_state(v_doc_id) s;
  if tg_op = 'UPDATE' and new.document_id is distinct from old.document_id then
    raise exception 'Une ligne ne peut pas changer de document.';
  end if;
  if v_type in ('facture', 'avoir') then
    if v_status is distinct from 'brouillon' then
      -- Seule exception : l'avoir libère les châssis de la facture qu'il annule.
      if not (tg_table_name = 'document_item_vehicles'
              and coalesce(current_setting('app.avoir_flow', true), '') = 'on') then
        raise exception 'Cette facture est émise : ses lignes ne peuvent plus être modifiées. Corrigez-la par un avoir.';
      end if;
    elsif not v_trusted and not is_invoice_editor() then
      raise exception 'Seule l''administration des ventes peut modifier une facture.';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_lock_issued_invoice_items on public.document_items;
create trigger trg_lock_issued_invoice_items
  before insert or update or delete on public.document_items
  for each row execute function public.lock_issued_invoice_children();

drop trigger if exists trg_lock_issued_invoice_vehicles on public.document_item_vehicles;
create trigger trg_lock_issued_invoice_vehicles
  before insert or update or delete on public.document_item_vehicles
  for each row execute function public.lock_issued_invoice_children();

-- ---------------------------------------------------------------------------
-- Numérotation : attribuée à l'enregistrement, sans trou pour factures/avoirs
-- ---------------------------------------------------------------------------
create or replace function public.get_next_document_number(p_organization_id uuid, p_document_type document_type, p_year integer)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_prefix text;
  v_next   int;
begin
  if p_organization_id is distinct from auth_org_id() and auth.uid() is not null then
    raise exception 'Organisation invalide';
  end if;
  -- Factures et avoirs : numéro donné uniquement au moment où le document est
  -- enregistré (trigger assign_document_number), jamais à l'avance.
  if p_document_type::text in ('facture', 'avoir')
     and pg_trigger_depth() = 0
     and coalesce(current_setting('app.doc_guard_bypass', true), '') <> 'on'
     and coalesce(current_setting('app.avoir_flow', true), '') <> 'on'
     and not doc_lock_purge_context() then
    raise exception 'Le numéro d''une facture est attribué automatiquement à son enregistrement.';
  end if;
  v_prefix := case p_document_type::text
    when 'proforma'      then 'PF'
    when 'devis'         then 'FP'
    when 'commande'      then 'CMD'
    when 'facture'       then 'FAC'
    when 'bon_livraison' then 'BL'
    when 'recu'          then 'REC'
    when 'avoir'         then 'AV'
  end;

  insert into document_number_counters (organization_id, document_type, year, last_number)
  values (p_organization_id, p_document_type, p_year, 1)
  on conflict (organization_id, document_type, year)
  do update set last_number = document_number_counters.last_number + 1
  returning last_number into v_next;

  return v_prefix || '-' || p_year || '-' || lpad(v_next::text, 6, '0');
end;
$$;
revoke all on function public.get_next_document_number(uuid, document_type, integer) from public, anon;
grant execute on function public.get_next_document_number(uuid, document_type, integer) to authenticated;

create or replace function public.assign_document_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.document_type::text in ('facture', 'avoir') then
    -- Un numéro fourni par l'application est ignoré : seul le compteur fait foi.
    new.document_number := get_next_document_number(new.organization_id, new.document_type,
                                                     extract(year from current_date)::int);
  elsif new.document_number is null or btrim(new.document_number) = '' then
    new.document_number := get_next_document_number(new.organization_id, new.document_type,
                                                     extract(year from current_date)::int);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_document_number on public.documents;
create trigger trg_assign_document_number
  before insert on public.documents
  for each row execute function public.assign_document_number();

-- ---------------------------------------------------------------------------
-- Création directe : un avoir ne se crée que par create_avoir, une facture
-- naît toujours en brouillon.
-- ---------------------------------------------------------------------------
alter policy documents_insert on public.documents
  with check (
    organization_id = auth_org_id()
    and (commercial_id = auth.uid()
         or auth_role()::text in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes'))
    and document_type::text <> 'avoir'
    and (document_type::text <> 'facture'
         or (status::text = 'brouillon'
             and auth_role()::text in ('super_admin', 'administrateur', 'manager', 'admin_ventes', 'comptable', 'receptionniste_sav', 'chef_atelier')))
  );

-- ---------------------------------------------------------------------------
-- Modification sécurisée (édition d'un brouillon)
-- ---------------------------------------------------------------------------
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.update_document_secure(uuid, uuid, text, jsonb, numeric, numeric, numeric)'::regprocedure);
  v_def := replace(v_def,
    $a$v_is_manager := v_role in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav');$a$,
    $b$v_is_manager := v_role in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes');

  -- Factures et avoirs : brouillon uniquement, et jamais par un commercial.
  if v_doc.document_type::text in ('facture', 'avoir') then
    if v_doc.status::text <> 'brouillon' then
      raise exception 'Cette facture est émise : elle ne peut plus être modifiée. Corrigez-la par un avoir.';
    end if;
    if not is_invoice_editor() then
      raise exception 'Seule l''administration des ventes peut modifier une facture.';
    end if;
  end if;$b$);
  if position('is_invoice_editor' in v_def) = 0 then
    raise exception 'update_document_secure : motif introuvable, migration à revoir';
  end if;
  execute v_def;
end;
$$;

-- ---------------------------------------------------------------------------
-- Suppression : jamais pour une facture ou un avoir
-- ---------------------------------------------------------------------------
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.delete_document_secure(uuid, boolean)'::regprocedure);
  v_def := replace(v_def,
    $a$select id, organization_id, document_number, commercial_id, parent_document_id$a$,
    $b$select id, organization_id, document_number, commercial_id, parent_document_id, document_type$b$);
  v_def := replace(v_def,
    $a$  select coalesce(sum(amount), 0) into v_paid from payments where document_id = p_document_id;$a$,
    $b$  if v_doc.document_type::text in ('facture', 'avoir') then
    raise exception 'Une facture ou un avoir ne se supprime jamais (numérotation officielle). Annulez le brouillon ou établissez un avoir.';
  end if;
  if exists (select 1 from documents c where c.parent_document_id = p_document_id
               and c.document_type::text in ('facture', 'avoir')) then
    raise exception 'Ce document a donné lieu à une facture : il ne peut plus être supprimé.';
  end if;

  select coalesce(sum(amount), 0) into v_paid from payments where document_id = p_document_id;$b$);
  if position('ne se supprime jamais' in v_def) = 0 then
    raise exception 'delete_document_secure : motif introuvable, migration à revoir';
  end if;
  execute v_def;
end;
$$;

-- ---------------------------------------------------------------------------
-- Émission d'une facture (brouillon -> émise)
-- ---------------------------------------------------------------------------
create or replace function public.issue_invoice(p_document_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_doc documents%rowtype;
begin
  if auth.uid() is null then raise exception 'Session expirée, reconnectez-vous.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;

  select * into v_doc from documents where id = p_document_id for update;
  if v_doc.id is null or v_doc.organization_id <> auth_org_id() then
    raise exception 'Document introuvable.';
  end if;
  if v_doc.document_type::text <> 'facture' then
    raise exception 'Seule une facture s''émet.';
  end if;
  if v_doc.status::text <> 'brouillon' then
    return 'deja';
  end if;
  if not is_invoice_editor() then
    raise exception 'Seule l''administration des ventes peut émettre une facture.';
  end if;
  if not exists (select 1 from document_items where document_id = p_document_id) then
    raise exception 'La facture ne contient aucun article.';
  end if;

  perform set_config('app.doc_guard_bypass', 'on', true);
  update documents
     set status = 'envoye',
         issue_date = current_date,
         due_date = greatest(coalesce(due_date, current_date), current_date),
         updated_at = now()
   where id = p_document_id;
  perform set_config('app.doc_guard_bypass', 'off', true);
  return 'ok';
end;
$$;
revoke all on function public.issue_invoice(uuid) from public, anon;
grant execute on function public.issue_invoice(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Remise en stock et libération des châssis d'une facture annulée
-- (fonction interne, appelée par cancel_draft_invoice et create_avoir)
-- ---------------------------------------------------------------------------
create or replace function public.reverse_invoice_effects(p_document_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_doc record;
  v_move record;
begin
  select id, organization_id, document_number, parent_document_id into v_doc from documents where id = p_document_id;

  for v_move in
    select product_id, sum(quantity) as quantity
      from stock_movements
     where reference_document_id = p_document_id
     group by product_id
    having sum(quantity) <> 0
  loop
    update products
       set quantity_on_hand = coalesce(quantity_on_hand, 0) - v_move.quantity, updated_at = now()
     where id = v_move.product_id;
    insert into stock_movements (organization_id, product_id, movement_type, quantity, reason, reference_document_id, performed_by)
    values (v_doc.organization_id, v_move.product_id, 'entree', -v_move.quantity,
            p_reason || ' ' || coalesce(v_doc.document_number, ''), p_document_id, auth.uid());
  end loop;

  -- Les châssis repartent (trigger release_vehicle_unit_link).
  update document_item_vehicles set removed_at = now()
   where document_id = p_document_id and removed_at is null;

  -- La commande d'origine redevient « à facturer ».
  if v_doc.parent_document_id is not null then
    update documents set status = 'brouillon', updated_at = now()
     where id = v_doc.parent_document_id and document_type::text = 'commande' and status::text = 'accepte';
  end if;
end;
$$;
revoke all on function public.reverse_invoice_effects(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Annulation d'une facture en brouillon (le numéro reste, marqué annulé)
-- ---------------------------------------------------------------------------
create or replace function public.cancel_draft_invoice(p_document_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_doc documents%rowtype;
begin
  if auth.uid() is null then raise exception 'Session expirée, reconnectez-vous.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;
  if not is_credit_note_issuer() then
    raise exception 'Seules l''administration des ventes et la direction peuvent annuler une facture.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Indiquez le motif de l''annulation.';
  end if;

  select * into v_doc from documents where id = p_document_id for update;
  if v_doc.id is null or v_doc.organization_id <> auth_org_id() then
    raise exception 'Document introuvable.';
  end if;
  if v_doc.document_type::text <> 'facture' then
    raise exception 'Seule une facture se gère ainsi.';
  end if;
  if v_doc.status::text = 'annule' then
    return 'deja';
  end if;
  if v_doc.status::text <> 'brouillon' then
    raise exception 'Cette facture est émise : elle s''annule uniquement par un avoir.';
  end if;
  if exists (select 1 from payments where document_id = p_document_id) then
    raise exception 'Un paiement est enregistré sur cette facture : établissez un avoir.';
  end if;

  perform set_config('app.doc_guard_bypass', 'on', true);
  -- D'abord le stock et les châssis (facture encore en brouillon), puis le statut.
  perform reverse_invoice_effects(p_document_id, 'Annulation facture');
  update documents set status = 'annule', updated_at = now() where id = p_document_id;
  perform set_config('app.doc_guard_bypass', 'off', true);

  perform add_document_history(p_document_id, 'motif', 'Motif de l''annulation : ' || btrim(p_reason));
  return 'ok';
end;
$$;
revoke all on function public.cancel_draft_invoice(uuid, text) from public, anon;
grant execute on function public.cancel_draft_invoice(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Avoir : seul moyen de corriger une facture émise
--   p_lines = null : avoir total (copie des lignes, la facture est annulée,
--                    stock et châssis reviennent, la commande est à refacturer)
--   p_lines = [...] : avoir partiel (geste commercial, erreur de prix) ;
--                    la facture reste valable, le montant crédité est déduit
--                    du chiffre d'affaires dans les rapports.
-- ---------------------------------------------------------------------------
create or replace function public.create_avoir(p_facture_id uuid, p_reason text, p_lines jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_fac documents%rowtype;
  v_lines jsonb;
  v_item jsonb;
  v_qty numeric; v_price numeric; v_tax numeric; v_discount numeric;
  v_product uuid;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total numeric;
  v_already numeric;
  v_new uuid;
  v_number text;
  v_full boolean;
begin
  if auth.uid() is null then raise exception 'Session expirée, reconnectez-vous.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;
  if not is_credit_note_issuer() then
    raise exception 'Seules l''administration des ventes et la direction peuvent établir un avoir.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Indiquez le motif de l''avoir.';
  end if;

  select * into v_fac from documents where id = p_facture_id for update;
  if v_fac.id is null or v_fac.organization_id <> auth_org_id() then
    raise exception 'Facture introuvable.';
  end if;
  if v_fac.document_type::text <> 'facture' then
    raise exception 'Un avoir se rattache uniquement à une facture.';
  end if;
  if v_fac.status::text = 'brouillon' then
    raise exception 'Cette facture est encore en brouillon : modifiez-la ou annulez-la directement.';
  end if;
  if v_fac.status::text = 'annule' then
    raise exception 'Cette facture est déjà annulée.';
  end if;

  select coalesce(sum(total_amount), 0) into v_already
    from documents
   where parent_document_id = v_fac.id and document_type::text = 'avoir' and status::text <> 'annule';

  if p_lines is null then
    if v_already > 0 then
      raise exception 'Un avoir partiel existe déjà : indiquez les lignes du nouvel avoir.';
    end if;
    select jsonb_agg(jsonb_build_object(
             'product_id', product_id, 'designation', designation, 'quantity', quantity,
             'unit_price', unit_price, 'tax_rate', tax_rate, 'discount_percent', discount_percent)
           order by position)
      into v_lines
      from document_items where document_id = v_fac.id;
  else
    v_lines := p_lines;
  end if;

  if v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'L''avoir doit contenir au moins une ligne.';
  end if;

  for v_item in select value from jsonb_array_elements(v_lines)
  loop
    if jsonb_typeof(v_item) <> 'object' or coalesce(btrim(v_item->>'designation'), '') = '' then
      raise exception 'Chaque ligne de l''avoir doit avoir une désignation.';
    end if;
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_tax := coalesce((v_item->>'tax_rate')::numeric, 0);
    v_discount := coalesce((v_item->>'discount_percent')::numeric, 0);
    if v_qty <= 0 then raise exception 'La quantité doit être supérieure à zéro.'; end if;
    if v_price < 0 then raise exception 'Le montant ne peut pas être négatif.'; end if;
    if v_tax < 0 or v_tax > 100 then raise exception 'Taux de TVA invalide.'; end if;
    if v_discount < 0 or v_discount > 100 then raise exception 'Remise invalide.'; end if;
    v_product := nullif(v_item->>'product_id', '')::uuid;
    if v_product is not null and not exists (select 1 from products where id = v_product and organization_id = v_fac.organization_id) then
      raise exception 'Produit introuvable.';
    end if;
    v_subtotal := v_subtotal + v_qty * v_price * (1 - v_discount / 100);
    v_tax_amount := v_tax_amount + v_qty * v_price * (1 - v_discount / 100) * (v_tax / 100);
  end loop;

  v_subtotal := round(v_subtotal, 2);
  v_tax_amount := round(v_tax_amount, 2);
  v_total := v_subtotal + v_tax_amount;

  if v_total <= 0 then
    raise exception 'Le montant de l''avoir doit être supérieur à zéro.';
  end if;
  if v_already + v_total > v_fac.total_amount + 1 then
    raise exception 'L''avoir dépasse le montant restant de la facture (reste : % FCFA).',
      replace(to_char(greatest(v_fac.total_amount - v_already, 0), 'FM999,999,999,990'), ',', ' ');
  end if;
  v_full := abs(v_already + v_total - v_fac.total_amount) <= 1;

  perform set_config('app.avoir_flow', 'on', true);

  insert into documents (organization_id, document_type, status, client_id, commercial_id, parent_document_id,
                         issue_date, due_date, subtotal, discount_amount, tax_amount, total_amount, notes)
  values (v_fac.organization_id, 'avoir', 'brouillon', v_fac.client_id, v_fac.commercial_id, v_fac.id,
          current_date, current_date, v_subtotal, 0, v_tax_amount, v_total,
          'Avoir sur la facture ' || v_fac.document_number || '. Motif : ' || btrim(p_reason))
  returning id, document_number into v_new, v_number;

  insert into document_items (document_id, product_id, designation, quantity, unit_price, tax_rate, discount_percent, position)
  select v_new,
         nullif(e.value->>'product_id', '')::uuid,
         btrim(e.value->>'designation'),
         (e.value->>'quantity')::numeric,
         coalesce((e.value->>'unit_price')::numeric, 0),
         coalesce((e.value->>'tax_rate')::numeric, 0),
         coalesce((e.value->>'discount_percent')::numeric, 0),
         (e.ord - 1)::int
    from jsonb_array_elements(v_lines) with ordinality as e(value, ord);

  -- L'avoir est émis immédiatement : il est figé comme une facture.
  update documents set status = 'envoye', updated_at = now() where id = v_new;

  perform add_document_history(v_fac.id, 'avoir',
    'Avoir ' || v_number || ' de ' || replace(to_char(v_total, 'FM999,999,999,990'), ',', ' ') || ' FCFA'
    || case when v_full then ' (annulation totale)' else ' (partiel)' end
    || '. Motif : ' || btrim(p_reason));
  perform add_document_history(v_new, 'motif', 'Motif : ' || btrim(p_reason));

  if v_full then
    update documents set status = 'annule', updated_at = now() where id = v_fac.id;
    perform reverse_invoice_effects(v_fac.id, 'Avoir ' || v_number || ' sur facture');
  end if;

  perform set_config('app.avoir_flow', 'off', true);
  return v_new;
end;
$$;
revoke all on function public.create_avoir(uuid, text, jsonb) from public, anon;
grant execute on function public.create_avoir(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Conversion : le numéro est donné par le trigger ; une facture annulée ne
-- bloque plus la refacturation de sa commande.
-- ---------------------------------------------------------------------------
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.convert_document(uuid, text)'::regprocedure);
  v_def := replace(v_def,
    $a$   where parent_document_id = v_src.id and document_type::text = p_target
   order by created_at limit 1;$a$,
    $b$   where parent_document_id = v_src.id and document_type::text = p_target and status::text <> 'annule'
   order by created_at limit 1;$b$);
  v_def := replace(v_def,
    $a$  v_number := get_next_document_number(v_src.organization_id, p_target::document_type, extract(year from current_date)::int);

$a$, '');
  v_def := replace(v_def,
    $a$  values (v_src.organization_id, p_target::document_type, v_number, 'brouillon',$a$,
    $b$  values (v_src.organization_id, p_target::document_type, null, 'brouillon',$b$);
  v_def := replace(v_def,
    $a$          v_src.tax_amount, v_src.total_amount, v_src.notes)
  returning id into v_new;$a$,
    $b$          v_src.tax_amount, v_src.total_amount, v_src.notes)
  returning id, document_number into v_new, v_number;$b$);
  if position('returning id, document_number into v_new, v_number' in v_def) = 0
     or position('get_next_document_number' in v_def) > 0
     or position($x$status::text <> 'annule'$x$ in v_def) = 0 then
    raise exception 'convert_document : motif introuvable, migration à revoir';
  end if;
  execute v_def;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rapports : montant des avoirs partiels de la période
-- ---------------------------------------------------------------------------
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.report_summary(date, date)'::regprocedure);
  v_def := replace(v_def,
    $a$'invoiced', (select coalesce(sum(total_amount), 0) from fac),$a$,
    $b$'invoiced', (select coalesce(sum(total_amount), 0) from fac),
      'credited', (select coalesce(sum(a.total_amount), 0) from documents a join documents f on f.id = a.parent_document_id
                    where a.organization_id = v_org and a.document_type::text = 'avoir' and a.status::text <> 'annule'
                      and f.status::text <> 'annule' and a.issue_date between p_from and p_to),$b$);
  if position('''credited''' in v_def) = 0 then
    raise exception 'report_summary : motif introuvable, migration à revoir';
  end if;
  execute v_def;
end;
$$;

alter function public.doc_lock_purge_context() set search_path = public;
alter function public.lock_issued_invoices() set search_path = public;
alter function public.lock_issued_invoice_children() set search_path = public;
alter function public.document_label(text) set search_path = public;
