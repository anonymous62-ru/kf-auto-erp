-- =============================================================================
-- 0051 : Facture non modifiable dès son émission (direction, 16/11/2026,
-- étape 3 : « Les factures restent non modifiables une fois émises »).
--
-- Avant : modifiable par l'ADV jusqu'au premier paiement (règle du 12/10).
-- Maintenant : dès que workflow_status = 'emise', plus aucune modification
-- du contenu ni des lignes en dehors des fonctions de confiance (paiements,
-- avoirs, annulation). La correction passe par un avoir.
-- =============================================================================
do $$
declare v_def text;
begin
  -- 1. Verrou sur la facture elle-même
  v_def := pg_get_functiondef('public.lock_issued_invoices()'::regprocedure);
  v_def := replace(v_def,
$a$  if not invoice_is_locked(old.document_type::text, old.status::text, old.amount_paid) then$a$,
$b$  if old.document_type::text = 'facture' and old.workflow_status = 'emise' and not v_trusted
     and (to_jsonb(new) - v_tracking) is distinct from (to_jsonb(old) - v_tracking) then
    raise exception 'Facture émise : elle ne peut plus être modifiée. Corrigez-la par un avoir.';
  end if;

  if not invoice_is_locked(old.document_type::text, old.status::text, old.amount_paid) then$b$);
  if position('Facture émise : elle ne peut plus' in v_def) = 0 then
    raise exception 'lock_issued_invoices : motif introuvable';
  end if;
  execute v_def;

  -- 2. Verrou sur les lignes et châssis
  v_def := pg_get_functiondef('public.lock_issued_invoice_children()'::regprocedure);
  v_def := replace(v_def,
$a$  select i.document_type, i.locked into v_type, v_locked from document_lock_info(v_doc_id) i;$a$,
$b$  select i.document_type, i.locked into v_type, v_locked from document_lock_info(v_doc_id) i;
  if v_type = 'facture' and not v_trusted
     and exists (select 1 from documents d where d.id = v_doc_id and d.workflow_status = 'emise') then
    raise exception 'Facture émise : ses lignes ne peuvent plus être modifiées. Corrigez-la par un avoir.';
  end if;$b$);
  if position('ses lignes ne peuvent plus' in v_def) = 0 then
    raise exception 'lock_issued_invoice_children : motif introuvable';
  end if;
  execute v_def;

  -- 3. Modification sécurisée : refus explicite (message clair)
  v_def := pg_get_functiondef('public.update_document_secure(uuid, uuid, text, jsonb, numeric, numeric, numeric)'::regprocedure);
  v_def := replace(v_def,
$a$    if v_doc.document_type::text = 'avoir' or v_doc.status::text = 'annule' then$a$,
$b$    if v_doc.document_type::text = 'facture' and v_doc.workflow_status = 'emise' then
      raise exception 'Facture émise : elle ne peut plus être modifiée. Corrigez-la par un avoir.';
    end if;
    if v_doc.document_type::text = 'avoir' or v_doc.status::text = 'annule' then$b$);
  if position('Facture émise : elle ne peut plus' in v_def) = 0 then
    raise exception 'update_document_secure : motif introuvable';
  end if;
  execute v_def;

  -- 4. Avoir possible sur toute facture émise (même sans paiement)
  v_def := pg_get_functiondef('public.create_avoir(uuid, text, jsonb)'::regprocedure);
  v_def := replace(v_def,
$a$     and not exists (select 1 from payments where document_id = v_fac.id) then$a$,
$b$     and not exists (select 1 from payments where document_id = v_fac.id)
     and coalesce(v_fac.workflow_status, '') <> 'emise' then$b$);
  if position($x$coalesce(v_fac.workflow_status, '') <> 'emise'$x$ in v_def) = 0 then
    raise exception 'create_avoir : motif introuvable';
  end if;
  execute v_def;
end;
$$;
-- Correctif 0051 : seules les factures issues d'un bon de commande (circuit
-- de vente véhicules) sont figées dès l'émission. Les factures directes
-- (atelier, pièces), créées document puis lignes, gardent la règle du 12/10
-- (modifiables par l'ADV jusqu'au premier paiement).
create or replace function public.is_issued_order_invoice(p_doc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from documents f join documents c on c.id = f.parent_document_id
     where f.id = p_doc and f.document_type::text = 'facture'
       and f.workflow_status = 'emise' and c.document_type::text = 'commande');
$$;
revoke all on function public.is_issued_order_invoice(uuid) from public, anon;
grant execute on function public.is_issued_order_invoice(uuid) to authenticated;

do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.lock_issued_invoices()'::regprocedure);
  v_def := replace(v_def,
$a$  if old.document_type::text = 'facture' and old.workflow_status = 'emise' and not v_trusted$a$,
$b$  if old.document_type::text = 'facture' and old.workflow_status = 'emise' and not v_trusted
     and is_issued_order_invoice(old.id)$b$);
  if position('is_issued_order_invoice(old.id)' in v_def) = 0 then raise exception 'lock_issued_invoices : motif introuvable'; end if;
  execute v_def;

  v_def := pg_get_functiondef('public.lock_issued_invoice_children()'::regprocedure);
  v_def := replace(v_def,
$a$     and exists (select 1 from documents d where d.id = v_doc_id and d.workflow_status = 'emise') then$a$,
$b$     and is_issued_order_invoice(v_doc_id) then$b$);
  if position('is_issued_order_invoice(v_doc_id)' in v_def) = 0 then raise exception 'lock_issued_invoice_children : motif introuvable'; end if;
  execute v_def;

  v_def := pg_get_functiondef('public.update_document_secure(uuid, uuid, text, jsonb, numeric, numeric, numeric)'::regprocedure);
  v_def := replace(v_def,
$a$    if v_doc.document_type::text = 'facture' and v_doc.workflow_status = 'emise' then$a$,
$b$    if v_doc.document_type::text = 'facture' and is_issued_order_invoice(v_doc.id) then$b$);
  if position('is_issued_order_invoice(v_doc.id)' in v_def) = 0 then raise exception 'update_document_secure : motif introuvable'; end if;
  execute v_def;
end;
$$;
