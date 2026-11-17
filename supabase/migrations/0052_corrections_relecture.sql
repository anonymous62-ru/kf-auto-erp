-- =============================================================================
-- 0052 : Corrections issues de la relecture de sécurité (17/11/2026)
--   a. Pièces clients (bucket client-documents) : 2FA exigée comme partout.
--   b. Bon de commande figé dès qu'il est déclaré conforme ; l'ADV peut le
--      repasser « non conforme » pour permettre une correction.
--   c. Un commercial ne peut pas annuler un bon de commande dont la facture
--      est en validation ou émise (le châssis resterait réservé).
--   d. Un véhicule (produit avec châssis en stock) ne se facture que par le
--      circuit bon de commande, jamais en facture directe.
--   e. Personne ne valide sa propre proforma.
--   f. Droits d'exécution d'une fonction de déclencheur retirés.
-- =============================================================================

-- a.
create policy client_documents_mfa on storage.objects as restrictive for all to authenticated
  using ((bucket_id <> 'client-documents') or (select mfa_satisfied()))
  with check ((bucket_id <> 'client-documents') or (select mfa_satisfied()));

do $$
declare v_def text;
begin
  -- b + d. Lignes
  v_def := pg_get_functiondef('public.document_items_workflow_guard()'::regprocedure);
  v_def := replace(v_def,
$a$  if v_type = 'commande' and v_step in ('facture_en_attente_validation', 'facture') then
    raise exception 'La facture de ce bon de commande est en validation ou émise : il ne peut plus être modifié.';
  end if;$a$,
$b$  if v_type = 'commande' and v_step in ('facture_en_attente_validation', 'facture') then
    raise exception 'La facture de ce bon de commande est en validation ou émise : il ne peut plus être modifié.';
  end if;
  if v_type = 'commande' and v_step = 'conforme' then
    raise exception 'Ce bon de commande a été déclaré conforme : il ne peut plus être modifié. Demandez à l''administration des ventes de le déclarer non conforme pour le corriger.';
  end if;
  if v_type = 'facture' and tg_op in ('INSERT', 'UPDATE') and new.product_id is not null
     and coalesce(wf_document_type((select parent_document_id from documents where id = new.document_id)), '') <> 'commande'
     and exists (select 1 from vehicle_units u where u.product_id = new.product_id) then
    raise exception 'Un véhicule se facture uniquement par le circuit : proforma, bon de commande vérifié par l''ADV, validation de la direction.';
  end if;$b$);
  if position('déclaré conforme : il ne peut plus' in v_def) = 0 then raise exception 'document_items_workflow_guard : motif introuvable'; end if;
  execute v_def;

  -- b + c. Document
  v_def := pg_get_functiondef('public.documents_workflow_guard()'::regprocedure);
  v_def := replace(v_def,
$a$          or v_type = 'commande' and old.workflow_status in ('facture_en_attente_validation', 'facture')) then$a$,
$b$          or v_type = 'commande' and old.workflow_status in ('conforme', 'facture_en_attente_validation', 'facture')) then$b$);
  v_def := replace(v_def,
$a$  return new;
end;$a$,
$b$  if v_api and v_type = 'commande' and new.status::text = 'annule' and old.status::text <> 'annule'
     and old.workflow_status in ('facture_en_attente_validation', 'facture') then
    raise exception 'La facture de ce bon de commande est en validation ou émise : il ne peut pas être annulé.';
  end if;
  return new;
end;$b$);
  if position($x$('conforme', 'facture_en_attente_validation', 'facture')$x$ in v_def) = 0
     or position('il ne peut pas être annulé' in v_def) = 0 then
    raise exception 'documents_workflow_guard : motif introuvable';
  end if;
  execute v_def;

  -- b. L'ADV peut repasser un bon de commande conforme en non conforme.
  v_def := pg_get_functiondef('public.check_commande(uuid, boolean, text)'::regprocedure);
  v_def := replace(v_def,
$a$  if d.workflow_status is distinct from 'a_verifier' then$a$,
$b$  if not (coalesce(d.workflow_status, '') = 'a_verifier'
          or coalesce(d.workflow_status, '') = 'conforme' and not p_conforme) then$b$);
  if position($x$= 'conforme' and not p_conforme$x$ in v_def) = 0 then raise exception 'check_commande : motif introuvable'; end if;
  execute v_def;

  -- e. Pas d'auto-validation
  v_def := pg_get_functiondef('public.validate_proforma(uuid, text)'::regprocedure);
  v_def := replace(v_def,
$a$  if d.workflow_status is distinct from 'en_attente_validation' then$a$,
$b$  if d.commercial_id = auth.uid() then
    raise exception 'Vous ne pouvez pas valider votre propre proforma : elle doit être validée par un autre responsable.';
  end if;
  if d.workflow_status is distinct from 'en_attente_validation' then$b$);
  if position('votre propre proforma' in v_def) = 0 then raise exception 'validate_proforma : motif introuvable'; end if;
  execute v_def;
end;
$$;

-- f.
revoke execute on function public.sales_objectives_guard() from public, anon, authenticated;
