-- =============================================================================
-- 0040 : Factures modifiables jusqu'au premier paiement (précision de la
-- direction, 12/10/2026)
--
-- Circuit : le commercial fait la proforma (modifiable librement : prix
-- négocié, caractéristiques) et la passe en commande ; l'administration des
-- ventes transforme la commande en facture. La facture reste modifiable par
-- l'administration des ventes tant qu'AUCUN paiement n'est enregistré. Dès
-- le premier versement (qui crée aussi le numéro client), elle est verrouillée
-- pour tout le monde : la correction passe alors par un avoir.
--
-- Remplace la règle de 0037 (verrou dès la sortie du brouillon).
-- =============================================================================

-- Une facture (ou un avoir) est verrouillée dès qu'un paiement existe, ou
-- quand elle est soldée / annulée. Un avoir est toujours figé.
create or replace function public.invoice_is_locked(p_type text, p_status text, p_amount_paid numeric)
returns boolean language sql immutable set search_path = public as $$
  select p_type = 'avoir' and p_status <> 'brouillon'
      or p_type = 'facture' and (p_status in ('paye_partiel', 'paye', 'annule') or coalesce(p_amount_paid, 0) > 0);
$$;

create or replace function public.document_lock_info(p_document_id uuid)
returns table (document_type text, locked boolean)
language sql stable security definer set search_path = public as $$
  select d.document_type::text,
         invoice_is_locked(d.document_type::text, d.status::text, d.amount_paid)
         or exists (select 1 from payments p where p.document_id = d.id)
    from documents d where d.id = p_document_id;
$$;
revoke all on function public.document_lock_info(uuid) from public, anon;
grant execute on function public.document_lock_info(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Verrou sur la facture elle-même
-- ---------------------------------------------------------------------------
create or replace function public.lock_issued_invoices()
returns trigger language plpgsql set search_path = public as $$
declare
  v_tracking text[] := array['status', 'amount_paid', 'balance_due', 'updated_at', 'last_reminder_at',
                             'pdf_url', 'synced_at', 'commercial_signature_url', 'client_signature_url', 'signed_at'];
  v_trusted boolean := pg_trigger_depth() > 1
                       or coalesce(current_setting('app.doc_guard_bypass', true), '') = 'on'
                       or coalesce(current_setting('app.avoir_flow', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    if old.document_type::text in ('facture', 'avoir') and not doc_lock_purge_context() then
      raise exception 'Une facture ou un avoir ne se supprime jamais (numérotation officielle). Annulez-la ou établissez un avoir.';
    end if;
    return old;
  end if;

  if old.document_type::text not in ('facture', 'avoir') or doc_lock_purge_context() then
    return new;
  end if;

  -- Avant tout paiement : l'administration des ventes la corrige librement.
  if not invoice_is_locked(old.document_type::text, old.status::text, old.amount_paid) then
    if not v_trusted and not is_invoice_editor()
       and (to_jsonb(new) - v_tracking) is distinct from (to_jsonb(old) - v_tracking) then
      raise exception 'Seule l''administration des ventes peut modifier une facture.';
    end if;
    if new.status::text in ('annule', 'refuse', 'accepte') and new.status is distinct from old.status and not v_trusted then
      raise exception 'Une facture s''annule avec le bouton « Annuler la facture ».';
    end if;
    return new;
  end if;

  -- Paiement enregistré : contenu figé pour tout le monde.
  if (to_jsonb(new) - v_tracking) is distinct from (to_jsonb(old) - v_tracking) then
    raise exception 'Un paiement est enregistré sur cette facture : elle ne peut plus être modifiée. Corrigez-la par un avoir.';
  end if;
  if old.commercial_signature_url is not null and new.commercial_signature_url is distinct from old.commercial_signature_url
     or old.client_signature_url is not null and new.client_signature_url is distinct from old.client_signature_url
     or old.signed_at is not null and new.signed_at is distinct from old.signed_at then
    raise exception 'La signature d''une facture payée ne peut pas être remplacée.';
  end if;
  if old.status::text = 'annule' and new.status::text <> 'annule' then
    raise exception 'Une facture annulée le reste.';
  end if;
  if new.status::text = 'annule' and old.status::text <> 'annule'
     and coalesce(current_setting('app.avoir_flow', true), '') <> 'on' then
    raise exception 'Une facture payée s''annule uniquement par un avoir.';
  end if;
  if new.status::text in ('brouillon', 'accepte', 'refuse') and new.status is distinct from old.status then
    raise exception 'Statut non autorisé pour une facture payée.';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Verrou sur les lignes et les châssis
-- ---------------------------------------------------------------------------
create or replace function public.lock_issued_invoice_children()
returns trigger language plpgsql set search_path = public as $$
declare
  v_doc_id uuid := case when tg_op = 'DELETE' then old.document_id else new.document_id end;
  v_type text;
  v_locked boolean;
  v_trusted boolean := pg_trigger_depth() > 1
                       or coalesce(current_setting('app.doc_guard_bypass', true), '') = 'on'
                       or coalesce(current_setting('app.avoir_flow', true), '') = 'on';
begin
  if doc_lock_purge_context() then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.document_id is distinct from old.document_id then
    raise exception 'Une ligne ne peut pas changer de document.';
  end if;
  select i.document_type, i.locked into v_type, v_locked from document_lock_info(v_doc_id) i;
  if v_type in ('facture', 'avoir') then
    if v_locked then
      if not (tg_table_name = 'document_item_vehicles'
              and coalesce(current_setting('app.avoir_flow', true), '') = 'on') then
        raise exception 'Un paiement est enregistré sur cette facture : ses lignes ne peuvent plus être modifiées. Corrigez-la par un avoir.';
      end if;
    elsif not v_trusted and not is_invoice_editor() then
      raise exception 'Seule l''administration des ventes peut modifier une facture.';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- Modification sécurisée : plus de condition « brouillon » pour les
-- factures (le refus en cas de paiement existait déjà).
-- ---------------------------------------------------------------------------
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.update_document_secure(uuid, uuid, text, jsonb, numeric, numeric, numeric)'::regprocedure);
  v_def := replace(v_def,
    $a$    if v_doc.status::text <> 'brouillon' then
      raise exception 'Cette facture est émise : elle ne peut plus être modifiée. Corrigez-la par un avoir.';
    end if;
$a$,
    $b$    if v_doc.document_type::text = 'avoir' or v_doc.status::text = 'annule' then
      raise exception 'Ce document ne peut plus être modifié.';
    end if;
$b$);
  if position('Ce document ne peut plus être modifié.' in v_def) = 0 then
    raise exception 'update_document_secure : motif introuvable, migration à revoir';
  end if;
  execute v_def;
end;
$$;

-- ---------------------------------------------------------------------------
-- Annulation : possible tant qu'aucun paiement n'est enregistré
-- ---------------------------------------------------------------------------
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.cancel_draft_invoice(uuid, text)'::regprocedure);
  v_def := replace(v_def,
    $a$  if v_doc.status::text <> 'brouillon' then
    raise exception 'Cette facture est émise : elle s''annule uniquement par un avoir.';
  end if;
$a$,
    $b$  if v_doc.status::text in ('paye', 'paye_partiel') or coalesce(v_doc.amount_paid, 0) > 0 then
    raise exception 'Un paiement est enregistré sur cette facture : établissez un avoir.';
  end if;
$b$);
  if position('établissez un avoir.' in v_def) = 0 or position('Cette facture est émise' in v_def) > 0 then
    raise exception 'cancel_draft_invoice : motif introuvable, migration à revoir';
  end if;
  execute v_def;
end;
$$;

-- ---------------------------------------------------------------------------
-- Avoir : seulement sur une facture verrouillée (paiement enregistré)
-- ---------------------------------------------------------------------------
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.create_avoir(uuid, text, jsonb)'::regprocedure);
  v_def := replace(v_def,
    $a$  if v_fac.status::text = 'brouillon' then
    raise exception 'Cette facture est encore en brouillon : modifiez-la ou annulez-la directement.';
  end if;$a$,
    $b$  if not invoice_is_locked('facture', v_fac.status::text, v_fac.amount_paid)
     and not exists (select 1 from payments where document_id = v_fac.id) then
    raise exception 'Aucun paiement sur cette facture : modifiez-la ou annulez-la directement.';
  end if;$b$);
  if position('Aucun paiement sur cette facture' in v_def) = 0 then
    raise exception 'create_avoir : motif introuvable, migration à revoir';
  end if;
  execute v_def;
end;
$$;

-- ---------------------------------------------------------------------------
-- Historique : libellés adaptés à la nouvelle règle
-- ---------------------------------------------------------------------------
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.log_document_history()'::regprocedure);
  v_def := replace(v_def,
    $a$      v_message := case when new.status::text = 'paye' then 'Entièrement payée' else 'Paiement partiel enregistré' end;$a$,
    $b$      v_message := case when new.status::text = 'paye' then 'Entièrement payée' else 'Paiement partiel enregistré' end
                   || case when new.document_type::text = 'facture' and old.status::text not in ('paye', 'paye_partiel')
                           then ' : la facture ne peut plus être modifiée' else '' end;$b$);
  v_def := replace(v_def,
    $a$      v_message := case when new.document_type::text = 'avoir' then 'Avoir émis : il ne peut plus être modifié'
                        else 'Facture émise : elle ne peut plus être modifiée' end;$a$,
    $b$      v_message := case when new.document_type::text = 'avoir' then 'Avoir émis : il ne peut plus être modifié'
                        else 'Facture envoyée au client' end;$b$);
  if position('Facture envoyée au client' in v_def) = 0 or position('la facture ne peut plus être modifiée' in v_def) = 0 then
    raise exception 'log_document_history : motif introuvable, migration à revoir';
  end if;
  execute v_def;
end;
$$;
