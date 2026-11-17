-- =============================================================================
-- 0044 : Circuit de vente (direction, 16/11/2026, étapes 1 et 2)
--
--   Proforma (type interne « devis ») :
--     brouillon -> en_attente_validation -> validee | refusee (motif)
--     validee -> envoyee -> acceptee -> conversion en bon de commande
--   Bon de commande :
--     a_verifier -> conforme | non_conforme (motif, retour au commercial)
--     conforme -> facture_en_attente_validation (ADV choisit le châssis)
--       -> validée par la direction (validated_at renseigné) ou refusée
--          (retour à conforme avec motif, véhicule libéré)
--       -> facture (l'ADV émet la facture définitive : numéro FAC attribué
--          à ce moment seulement, véhicule « vendu »)
--
-- Décisions :
--   * La « facture en attente de validation » vit sur le bon de commande :
--     aucun numéro de facture officiel n'est consommé avant l'émission.
--   * Le châssis choisi est lié aux lignes du bon de commande
--     (document_item_vehicles) et le véhicule passe « réservé » ; il est
--     recopié sur la facture à l'émission (convert_document).
--   * Les colonnes du circuit ne s'écrivent que par les fonctions ci-dessous
--     (SECURITY DEFINER) : une écriture directe par l'API est refusée.
--   * Une seule facture non annulée par châssis (trigger sur
--     document_item_vehicles + contrôle à l'émission).
--
-- Appliquée en 4 parties : 0044a (gardes et triggers), 0044b (fonctions du
-- circuit), 0044c (conversion et châssis), 0044d (rôle N+1 dans la RLS).
-- =============================================================================

-- =============================================================================
-- 0044a : gardes et triggers
-- =============================================================================

-- Type d'un document de la même organisation (utilisé par la garde, qui
-- s'exécute avec les droits de l'appelant).
create or replace function public.wf_document_type(p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select document_type::text from documents where id = p_id and organization_id = auth_org_id();
$$;
revoke all on function public.wf_document_type(uuid) from public, anon;
grant execute on function public.wf_document_type(uuid) to authenticated;

-- Garde du circuit (SECURITY INVOKER volontairement : current_user vaut
-- « authenticated » pour un appel direct de l'API et « postgres » dans les
-- fonctions de confiance).
create or replace function public.documents_workflow_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_api boolean := current_user in ('authenticated', 'anon');
  v_type text := new.document_type::text;
  v_parent_type text;
begin
  if tg_op = 'INSERT' then
    if v_api then
      new.workflow_reason := null;
      new.workflow_changed_by := null;
      new.submitted_by := null;
      new.submitted_at := null;
      new.validated_by := null;
      new.validated_at := null;
      new.n1_signature_url := null;
      new.n1_signed_by := null;
      new.n1_signed_at := null;
      new.workflow_status := null;
    end if;
    if new.workflow_status is null then
      new.workflow_changed_at := now();
      if v_type in ('devis', 'proforma') then
        new.workflow_status := 'brouillon';
      elsif v_type = 'commande' then
        if v_api then
          raise exception 'Un bon de commande naît d''une proforma acceptée par le client (bouton « Convertir en bon de commande »).';
        end if;
        new.workflow_status := 'a_verifier';
      elsif v_type = 'facture' then
        if new.parent_document_id is not null then
          v_parent_type := wf_document_type(new.parent_document_id);
        end if;
        if v_parent_type = 'commande' then
          if v_api then
            raise exception 'La facture d''un bon de commande est émise par l''administration des ventes après validation de la direction.';
          end if;
          new.workflow_status := 'en_preparation';
        else
          -- Facture directe (atelier, pièces) : hors circuit véhicule.
          new.workflow_status := 'emise';
        end if;
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if v_api and (
       new.workflow_status is distinct from old.workflow_status
    or new.workflow_reason is distinct from old.workflow_reason
    or new.workflow_changed_at is distinct from old.workflow_changed_at
    or new.workflow_changed_by is distinct from old.workflow_changed_by
    or new.submitted_by is distinct from old.submitted_by
    or new.submitted_at is distinct from old.submitted_at
    or new.validated_by is distinct from old.validated_by
    or new.validated_at is distinct from old.validated_at
    or new.n1_signature_url is distinct from old.n1_signature_url
    or new.n1_signed_by is distinct from old.n1_signed_by
    or new.n1_signed_at is distinct from old.n1_signed_at) then
    raise exception 'Le circuit de validation avance uniquement par les boutons prévus (soumission, validation, vérification, émission).';
  end if;

  -- Signature du client : seulement sur une proforma validée par le N+1.
  if v_type in ('devis', 'proforma') and new.client_signature_url is not null and old.client_signature_url is null
     and coalesce(new.workflow_status, '') not in ('validee', 'envoyee', 'acceptee') then
    raise exception 'La proforma doit être validée par le responsable commercial avant la signature du client.';
  end if;

  -- Contenu figé pendant et après la validation.
  if v_api and (new.client_id is distinct from old.client_id or new.notes is distinct from old.notes
                or new.due_date is distinct from old.due_date)
     and (v_type in ('devis', 'proforma') and old.workflow_status in ('en_attente_validation', 'validee', 'envoyee', 'acceptee')
          or v_type = 'commande' and old.workflow_status in ('facture_en_attente_validation', 'facture')) then
    raise exception 'Ce document est en validation ou validé : il ne peut plus être modifié.';
  end if;
  return new;
end;
$$;

-- Nom choisi pour passer après trg_assign_document_number (ordre alphabétique).
create trigger trg_workflow_guard
  before insert or update on public.documents
  for each row execute function public.documents_workflow_guard();

-- Lignes figées pendant et après la validation (update_document_secure
-- supprime puis réinsère les lignes : l'insertion est refusée ici).
create or replace function public.document_items_workflow_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_type text;
  v_step text;
begin
  if coalesce(current_setting('app.workflow_flow', true), '') = 'on' then
    return new;
  end if;
  select document_type::text, workflow_status into v_type, v_step from documents where id = new.document_id;
  if v_type in ('devis', 'proforma') and v_step in ('en_attente_validation', 'validee', 'envoyee', 'acceptee') then
    raise exception 'Cette proforma est soumise ou validée : elle ne peut plus être modifiée. Pour la corriger, le responsable commercial doit la refuser avec un motif.';
  end if;
  if v_type = 'commande' and v_step in ('facture_en_attente_validation', 'facture') then
    raise exception 'La facture de ce bon de commande est en validation ou émise : il ne peut plus être modifié.';
  end if;
  return new;
end;
$$;

create trigger trg_workflow_items_guard
  before insert or update on public.document_items
  for each row execute function public.document_items_workflow_guard();

-- Une seule facture non annulée par châssis.
create or replace function public.document_item_vehicles_one_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_type text;
  v_status text;
  v_other text;
  v_vin text;
begin
  if new.removed_at is not null then
    return new;
  end if;
  select document_type::text, status::text into v_type, v_status from documents where id = new.document_id;
  if v_type <> 'facture' or v_status = 'annule' then
    return new;
  end if;
  select vin into v_vin from vehicle_units where id = new.vehicle_unit_id for update;
  select d.document_number into v_other
    from document_item_vehicles v join documents d on d.id = v.document_id
   where v.vehicle_unit_id = new.vehicle_unit_id and v.removed_at is null and v.id <> new.id
     and d.id <> new.document_id and d.document_type::text = 'facture' and d.status::text <> 'annule'
   limit 1;
  if v_other is not null then
    raise exception 'Le châssis % est déjà facturé (facture %) : une seule facture par châssis.', v_vin, v_other;
  end if;
  return new;
end;
$$;

create trigger trg_one_invoice_per_vehicle
  before insert or update on public.document_item_vehicles
  for each row execute function public.document_item_vehicles_one_invoice();

-- Après insertion / changement de statut :
--   * nouveau bon de commande -> action « à vérifier » pour l'ADV ;
--   * facture du circuit annulée (annulation ou avoir total) -> le bon de
--     commande redevient « conforme », ses châssis sont libérés.
create or replace function public.documents_workflow_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_adv uuid[];
  v_parent documents%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.document_type::text = 'commande' then
      v_adv := array(select org_user_ids(new.organization_id, array['admin_ventes']));
      if coalesce(array_length(v_adv, 1), 0) = 0 then
        v_adv := array(select org_user_ids(new.organization_id, array['super_admin']));
      end if;
      perform create_action('commande_a_verifier', v_adv,
        'Bon de commande à vérifier',
        format('Le bon de commande %s est à vérifier (client, pièces justificatives, banque, montants).', new.document_number),
        '/documents/' || new.id, new.id, null, document_mail_payload(new.id));
    end if;
    return null;
  end if;

  if new.document_type::text = 'facture' and new.status::text = 'annule' and old.status::text <> 'annule'
     and new.parent_document_id is not null then
    select * into v_parent from documents where id = new.parent_document_id;
    if v_parent.document_type::text = 'commande' and v_parent.workflow_status = 'facture' then
      update document_item_vehicles set removed_at = now()
       where document_id = v_parent.id and removed_at is null;
      update documents
         set workflow_status = 'conforme', validated_by = null, validated_at = null,
             workflow_reason = format('Facture %s annulée : préparez une nouvelle facture.', new.document_number),
             workflow_changed_at = now(), workflow_changed_by = auth.uid()
       where id = v_parent.id;
      perform add_document_history(v_parent.id, 'circuit',
        format('Facture %s annulée : bon de commande de nouveau à facturer, châssis libérés', new.document_number));
    end if;
  end if;
  return null;
end;
$$;

create trigger trg_workflow_after
  after insert or update of status on public.documents
  for each row execute function public.documents_workflow_after();

revoke all on function public.documents_workflow_after() from public, anon, authenticated;
revoke all on function public.document_item_vehicles_one_invoice() from public, anon, authenticated;
revoke all on function public.document_items_workflow_guard() from public, anon, authenticated;

-- =============================================================================
-- 0044b : fonctions du circuit
-- =============================================================================

-- Charge et verrouille un document de l'organisation (anti double clic : la
-- seconde requête attend la première puis voit le nouvel état).
create or replace function public.wf_load(p_id uuid)
returns public.documents language plpgsql security definer set search_path = public as $$
declare v documents%rowtype;
begin
  if auth.uid() is null then raise exception 'Session expirée, reconnectez-vous.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;
  select * into v from documents where id = p_id for update;
  if v.id is null or v.organization_id <> auth_org_id() then raise exception 'Document introuvable.'; end if;
  return v;
end;
$$;

create or replace function public.wf_set(p_id uuid, p_step text, p_reason text, p_message text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update documents
     set workflow_status = p_step, workflow_reason = p_reason,
         workflow_changed_at = now(), workflow_changed_by = auth.uid()
   where id = p_id;
  perform add_document_history(p_id, 'circuit', p_message);
end;
$$;

-- Destinataires : N+1 (à défaut la direction), ADV (à défaut super admin),
-- direction (manager, DG).
create or replace function public.wf_recipients(p_org uuid, p_group text)
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare v uuid[];
begin
  if p_group = 'n1' then
    v := array(select org_user_ids(p_org, array['responsable_commercial']));
    if coalesce(array_length(v, 1), 0) = 0 then
      v := array(select org_user_ids(p_org, array['manager', 'administrateur']));
    end if;
  elsif p_group = 'adv' then
    v := array(select org_user_ids(p_org, array['admin_ventes']));
    if coalesce(array_length(v, 1), 0) = 0 then
      v := array(select org_user_ids(p_org, array['super_admin']));
    end if;
  elsif p_group = 'direction' then
    v := array(select org_user_ids(p_org, array['administrateur', 'manager']));
  elsif p_group = 'comptable' then
    v := array(select org_user_ids(p_org, array['comptable']));
  end if;
  return coalesce(v, '{}');
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['public.wf_load(uuid)', 'public.wf_set(uuid, text, text, text)', 'public.wf_recipients(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;

-- ---------- 1. Proforma ----------

create or replace function public.submit_proforma(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare d documents%rowtype;
begin
  d := wf_load(p_id);
  if d.document_type::text not in ('devis', 'proforma') then raise exception 'Seule une proforma se soumet à validation.'; end if;
  if d.commercial_id <> auth.uid() and not is_proforma_validator() then
    raise exception 'Vous ne pouvez soumettre que vos propres proformas.';
  end if;
  if d.status::text in ('annule', 'refuse') then raise exception 'Cette proforma est annulée.'; end if;
  if d.workflow_status = 'en_attente_validation' then raise exception 'Cette proforma est déjà soumise à validation.'; end if;
  if coalesce(d.workflow_status, 'brouillon') not in ('brouillon', 'refusee') then
    raise exception 'Cette proforma est déjà validée.';
  end if;
  if not exists (select 1 from document_items where document_id = d.id) then
    raise exception 'Ajoutez au moins un article avant de soumettre.';
  end if;
  update documents set submitted_by = auth.uid(), submitted_at = now() where id = d.id;
  perform wf_set(d.id, 'en_attente_validation', null, 'Soumise à validation du responsable commercial');
  perform create_action('proforma_a_valider', wf_recipients(d.organization_id, 'n1'),
    'Proforma à valider',
    format('La proforma %s attend votre validation.', d.document_number),
    '/documents/' || d.id, d.id, null, document_mail_payload(d.id));
  return 'ok';
end;
$$;

create or replace function public.validate_proforma(p_id uuid, p_n1_signature_url text)
returns text language plpgsql security definer set search_path = public as $$
declare d documents%rowtype;
begin
  d := wf_load(p_id);
  if d.document_type::text not in ('devis', 'proforma') then raise exception 'Seule une proforma se valide ici.'; end if;
  if not is_proforma_validator() then
    raise exception 'Seuls le responsable commercial, le manager et la direction valident une proforma.';
  end if;
  if d.workflow_status is distinct from 'en_attente_validation' then
    raise exception 'Cette proforma n''est plus en attente de validation.';
  end if;
  if coalesce(btrim(p_n1_signature_url), '') = '' or position('/document-signatures/' in p_n1_signature_url) = 0
     or position(d.id::text in p_n1_signature_url) = 0 then
    raise exception 'Signez la proforma avant de la valider.';
  end if;
  update documents
     set validated_by = auth.uid(), validated_at = now(),
         n1_signature_url = p_n1_signature_url, n1_signed_by = auth.uid(), n1_signed_at = now()
   where id = d.id;
  perform wf_set(d.id, 'validee', null, 'Validée et signée par le responsable commercial');
  perform resolve_actions(d.id, array['proforma_a_valider']);
  perform push_notification(d.commercial_id, 'proforma_validee', 'Proforma validée',
    format('Votre proforma %s est validée : vous pouvez l''envoyer au client.', d.document_number),
    '/documents/' || d.id, d.id, false, 'info', document_mail_payload(d.id));
  return 'ok';
end;
$$;

create or replace function public.refuse_proforma(p_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare d documents%rowtype;
begin
  d := wf_load(p_id);
  if d.document_type::text not in ('devis', 'proforma') then raise exception 'Seule une proforma se refuse ici.'; end if;
  if not is_proforma_validator() then
    raise exception 'Seuls le responsable commercial, le manager et la direction valident une proforma.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Indiquez le motif du refus.'; end if;
  if d.workflow_status is distinct from 'en_attente_validation' then
    raise exception 'Cette proforma n''est plus en attente de validation.';
  end if;
  perform wf_set(d.id, 'refusee', btrim(p_reason), 'Refusée par le responsable commercial : ' || btrim(p_reason));
  perform resolve_actions(d.id, array['proforma_a_valider']);
  perform push_notification(d.commercial_id, 'proforma_refusee', 'Proforma refusée',
    format('Votre proforma %s est refusée. Motif : %s', d.document_number, btrim(p_reason)),
    '/documents/' || d.id, d.id, true, 'info', document_mail_payload(d.id) || jsonb_build_object('reason', btrim(p_reason)));
  return 'ok';
end;
$$;

-- Envoi au client : appelée à chaque envoi (WhatsApp, e-mail). Un nouvel
-- envoi d'une proforma déjà envoyée ou acceptée ne change rien.
create or replace function public.mark_proforma_sent(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare d documents%rowtype;
begin
  d := wf_load(p_id);
  if d.document_type::text not in ('devis', 'proforma') then return 'hors_circuit'; end if;
  if d.commercial_id <> auth.uid() and not is_proforma_validator() then
    raise exception 'Vous ne pouvez envoyer que vos propres proformas.';
  end if;
  if d.workflow_status in ('envoyee', 'acceptee') then return 'deja'; end if;
  if d.workflow_status is distinct from 'validee' then
    raise exception 'La proforma doit être validée par le responsable commercial avant d''être envoyée.';
  end if;
  perform wf_set(d.id, 'envoyee', null, 'Envoyée au client');
  return 'ok';
end;
$$;

create or replace function public.mark_proforma_accepted(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare d documents%rowtype;
begin
  d := wf_load(p_id);
  if d.document_type::text not in ('devis', 'proforma') then raise exception 'Seule une proforma est acceptée par le client.'; end if;
  if d.commercial_id <> auth.uid() and not is_proforma_validator() then
    raise exception 'Vous ne pouvez modifier que vos propres proformas.';
  end if;
  if d.workflow_status = 'acceptee' then raise exception 'Cette proforma est déjà acceptée par le client.'; end if;
  if d.workflow_status not in ('validee', 'envoyee') then
    raise exception 'La proforma doit être validée par le responsable commercial avant l''accord du client.';
  end if;
  perform wf_set(d.id, 'acceptee', null, 'Acceptée par le client');
  return 'ok';
end;
$$;

-- ---------- 2. Bon de commande ----------

create or replace function public.check_commande(p_id uuid, p_conforme boolean, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare d documents%rowtype;
begin
  d := wf_load(p_id);
  if d.document_type::text <> 'commande' then raise exception 'Seul un bon de commande se vérifie ici.'; end if;
  if not is_adv() then raise exception 'Seule l''administration des ventes vérifie un bon de commande.'; end if;
  if d.workflow_status is distinct from 'a_verifier' then
    raise exception 'Ce bon de commande n''est plus à vérifier.';
  end if;
  if p_conforme then
    perform wf_set(d.id, 'conforme', null, 'Déclaré conforme par l''administration des ventes (client, pièces, banque, montants)');
    perform resolve_actions(d.id, array['commande_a_verifier']);
    perform push_notification(d.commercial_id, 'commande_conforme', 'Bon de commande conforme',
      format('Le bon de commande %s est conforme : il peut être envoyé au client.', d.document_number),
      '/documents/' || d.id, d.id, false, 'info', document_mail_payload(d.id));
  else
    if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Indiquez le motif de non-conformité.'; end if;
    perform wf_set(d.id, 'non_conforme', btrim(p_reason), 'Non conforme : ' || btrim(p_reason));
    perform resolve_actions(d.id, array['commande_a_verifier']);
    perform push_notification(d.commercial_id, 'commande_non_conforme', 'Bon de commande non conforme',
      format('Le bon de commande %s est non conforme. Motif : %s', d.document_number, btrim(p_reason)),
      '/documents/' || d.id, d.id, true, 'info', document_mail_payload(d.id) || jsonb_build_object('reason', btrim(p_reason)));
  end if;
  return 'ok';
end;
$$;

-- Le commercial a corrigé le dossier : nouvelle vérification par l'ADV.
create or replace function public.resubmit_commande(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare d documents%rowtype;
begin
  d := wf_load(p_id);
  if d.document_type::text <> 'commande' then raise exception 'Seul un bon de commande se renvoie en vérification.'; end if;
  if d.commercial_id <> auth.uid() and not is_proforma_validator() and not is_adv() then
    raise exception 'Vous ne pouvez renvoyer que vos propres bons de commande.';
  end if;
  if d.workflow_status is distinct from 'non_conforme' then
    raise exception 'Ce bon de commande n''est pas en retour pour non-conformité.';
  end if;
  perform wf_set(d.id, 'a_verifier', null, 'Dossier corrigé, renvoyé à l''administration des ventes');
  perform create_action('commande_a_verifier', wf_recipients(d.organization_id, 'adv'),
    'Bon de commande à vérifier',
    format('Le bon de commande %s a été corrigé et attend une nouvelle vérification.', d.document_number),
    '/documents/' || d.id, d.id, null, document_mail_payload(d.id));
  return 'ok';
end;
$$;

-- Préparation de la facture : choix des châssis disponibles (un par véhicule
-- du bon de commande, du même modèle). Aucun numéro de facture n'est pris.
create or replace function public.prepare_invoice(p_commande_id uuid, p_vehicle_unit_ids uuid[])
returns text language plpgsql security definer set search_path = public as $$
declare
  d documents%rowtype;
  v_ids uuid[] := coalesce(p_vehicle_unit_ids, '{}');
  v_count int;
  v_unit record;
  v_active uuid;
begin
  d := wf_load(p_commande_id);
  if d.document_type::text <> 'commande' then raise exception 'La facture se prépare depuis un bon de commande.'; end if;
  if not is_adv() then raise exception 'Seule l''administration des ventes prépare une facture.'; end if;
  if d.status::text in ('annule', 'refuse') then raise exception 'Ce bon de commande est annulé.'; end if;
  if d.workflow_status = 'facture_en_attente_validation' then
    raise exception 'La facture est déjà préparée et attend la validation de la direction.';
  end if;
  if d.workflow_status is distinct from 'conforme' then
    raise exception 'Le bon de commande doit d''abord être déclaré conforme.';
  end if;
  if not exists (select 1 from document_items where document_id = d.id) then
    raise exception 'Ce bon de commande ne contient aucun article.';
  end if;
  if exists (select 1 from document_items where document_id = d.id and product_id is not null and quantity <> floor(quantity)) then
    raise exception 'La quantité d''un véhicule doit être un nombre entier.';
  end if;

  select count(distinct x) into v_count from unnest(v_ids) x;
  if v_count <> coalesce(array_length(v_ids, 1), 0) then raise exception 'Un même châssis est choisi deux fois.'; end if;

  -- Verrou des véhicules (deux préparations simultanées ne prennent pas le même).
  for v_unit in select * from vehicle_units where id = any (v_ids) order by id for update loop
    if v_unit.organization_id <> d.organization_id then raise exception 'Véhicule introuvable.'; end if;
    if v_unit.status <> 'disponible' then
      raise exception 'Le châssis % n''est plus disponible.', v_unit.vin;
    end if;
    v_active := vehicle_unit_active_document(v_unit.id);
    if v_active is not null and v_active <> d.id then
      raise exception 'Le châssis % est déjà attribué à un autre dossier.', v_unit.vin;
    end if;
  end loop;
  if (select count(*) from vehicle_units where id = any (v_ids)) <> v_count then
    raise exception 'Véhicule introuvable.';
  end if;

  -- Un châssis par véhicule commandé, modèle par modèle.
  if exists (
    select 1
      from (select product_id, sum(quantity)::int n from document_items
             where document_id = d.id and product_id is not null group by product_id) need
      full join (select product_id, count(*)::int n from vehicle_units where id = any (v_ids) group by product_id) got
        using (product_id)
     where coalesce(need.n, 0) <> coalesce(got.n, 0)
  ) then
    raise exception 'Choisissez un châssis disponible du bon modèle pour chaque véhicule du bon de commande.';
  end if;

  perform set_config('app.doc_guard_bypass', 'on', true);
  update document_item_vehicles set removed_at = now() where document_id = d.id and removed_at is null;

  insert into document_item_vehicles (document_id, document_item_id, vehicle_unit_id)
  select d.id, s.item_id, u.id
    from (select di.id as item_id, di.product_id,
                 row_number() over (partition by di.product_id order by di.position, di.id, g) as rn
            from document_items di, generate_series(1, di.quantity::int) g
           where di.document_id = d.id and di.product_id is not null) s
    join (select vu.id, vu.product_id,
                 row_number() over (partition by vu.product_id order by vu.entry_date, vu.created_at, vu.id) as rn
            from vehicle_units vu where vu.id = any (v_ids)) u
      on u.product_id = s.product_id and u.rn = s.rn
  on conflict (document_item_id, vehicle_unit_id) do update set removed_at = null;

  update vehicle_units set status = 'reserve' where id = any (v_ids);
  perform set_config('app.doc_guard_bypass', 'off', true);

  update documents set validated_by = null, validated_at = null where id = d.id;
  perform wf_set(d.id, 'facture_en_attente_validation', null,
    'Facture préparée' || coalesce(' (châssis ' || (select string_agg(vin, ', ' order by vin) from vehicle_units where id = any (v_ids)) || ')', '')
    || ', en attente de validation de la direction');
  perform create_action('facture_a_valider', wf_recipients(d.organization_id, 'direction'),
    'Facture à valider',
    format('La facture du bon de commande %s attend votre validation.', d.document_number),
    '/documents/' || d.id, d.id, null, document_mail_payload(d.id));
  return 'ok';
end;
$$;

create or replace function public.validate_invoice(p_commande_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare d documents%rowtype;
begin
  d := wf_load(p_commande_id);
  if d.document_type::text <> 'commande' then raise exception 'Document introuvable.'; end if;
  if not is_direction() then raise exception 'Seule la direction (manager, DG) valide une facture.'; end if;
  if d.workflow_status is distinct from 'facture_en_attente_validation' then
    raise exception 'Aucune facture en attente de validation sur ce bon de commande.';
  end if;
  if d.validated_at is not null then raise exception 'Cette facture est déjà validée.'; end if;
  update documents set validated_by = auth.uid(), validated_at = now(), workflow_reason = null where id = d.id;
  perform add_document_history(d.id, 'circuit', 'Facture validée par la direction');
  perform resolve_actions(d.id, array['facture_a_valider']);
  perform create_action('facture_a_emettre', wf_recipients(d.organization_id, 'adv'),
    'Facture à émettre',
    format('La facture du bon de commande %s est validée par la direction : émettez la facture définitive.', d.document_number),
    '/documents/' || d.id, d.id, null, document_mail_payload(d.id));
  return 'ok';
end;
$$;

create or replace function public.refuse_invoice(p_commande_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare
  d documents%rowtype;
  v_user uuid;
begin
  d := wf_load(p_commande_id);
  if d.document_type::text <> 'commande' then raise exception 'Document introuvable.'; end if;
  if not is_direction() then raise exception 'Seule la direction (manager, DG) valide une facture.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Indiquez le motif du refus.'; end if;
  if d.workflow_status is distinct from 'facture_en_attente_validation' or d.validated_at is not null then
    raise exception 'Aucune facture en attente de validation sur ce bon de commande.';
  end if;
  -- Véhicules libérés (trigger release_vehicle_unit_link : retour « disponible »).
  update document_item_vehicles set removed_at = now() where document_id = d.id and removed_at is null;
  perform wf_set(d.id, 'conforme', 'Facture refusée par la direction : ' || btrim(p_reason),
    'Facture refusée par la direction : ' || btrim(p_reason) || ' (châssis libéré)');
  perform resolve_actions(d.id, array['facture_a_valider']);
  foreach v_user in array wf_recipients(d.organization_id, 'adv') loop
    perform push_notification(v_user, 'facture_refusee', 'Facture refusée',
      format('La facture du bon de commande %s est refusée par la direction. Motif : %s', d.document_number, btrim(p_reason)),
      '/documents/' || d.id, d.id, true, 'info', document_mail_payload(d.id) || jsonb_build_object('reason', btrim(p_reason)));
  end loop;
  return 'ok';
end;
$$;

-- Émission de la facture définitive : seul moment où un numéro FAC est pris.
create or replace function public.issue_final_invoice(p_commande_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  d documents%rowtype;
  v_units uuid[];
  v_unit record;
  v_fac uuid;
  v_fac_row documents%rowtype;
  v_user uuid;
begin
  d := wf_load(p_commande_id);
  if d.document_type::text <> 'commande' then raise exception 'La facture s''émet depuis un bon de commande.'; end if;
  if not is_adv() then raise exception 'Seule l''administration des ventes émet une facture.'; end if;
  if d.workflow_status = 'facture' then raise exception 'La facture de ce bon de commande est déjà émise.'; end if;
  if d.workflow_status is distinct from 'facture_en_attente_validation' or d.validated_at is null then
    raise exception 'La facture doit d''abord être validée par la direction.';
  end if;

  v_units := array(select vehicle_unit_id from document_item_vehicles where document_id = d.id and removed_at is null);
  for v_unit in select * from vehicle_units where id = any (v_units) order by id for update loop
    if v_unit.status <> 'reserve' then
      raise exception 'Le châssis % n''est plus réservé pour ce bon de commande (statut %).', v_unit.vin, v_unit.status;
    end if;
    if exists (select 1 from document_item_vehicles v join documents f on f.id = v.document_id
                where v.vehicle_unit_id = v_unit.id and v.removed_at is null
                  and f.document_type::text = 'facture' and f.status::text <> 'annule') then
      raise exception 'Le châssis % est déjà facturé : une seule facture par châssis.', v_unit.vin;
    end if;
  end loop;

  perform set_config('app.invoice_flow', 'on', true);
  v_fac := convert_document(d.id, 'facture');
  perform set_config('app.invoice_flow', 'off', true);

  select * into v_fac_row from documents where id = v_fac;
  if v_fac_row.workflow_status is distinct from 'en_preparation' then
    raise exception 'Une facture existe déjà pour ce bon de commande (%).', v_fac_row.document_number;
  end if;

  update documents
     set workflow_status = 'emise', workflow_reason = null, workflow_changed_at = now(), workflow_changed_by = auth.uid(),
         validated_by = d.validated_by, validated_at = d.validated_at
   where id = v_fac;
  perform add_document_history(v_fac, 'circuit', 'Facture émise après validation de la direction');

  perform set_config('app.doc_guard_bypass', 'on', true);
  update vehicle_units set status = 'vendu', sold_document_id = v_fac, sold_at = now() where id = any (v_units);
  -- Caractéristiques courtes figées à l'émission (lues par le PDF).
  update document_items di set short_specs_snapshot = p.short_specs
    from products p
   where di.document_id = v_fac and p.id = di.product_id and nullif(btrim(p.short_specs), '') is not null;
  perform set_config('app.doc_guard_bypass', 'off', true);

  perform wf_set(d.id, 'facture', null, format('Facturé : facture %s émise', v_fac_row.document_number));
  perform resolve_actions(d.id, array['facture_a_emettre', 'facture_a_valider']);

  foreach v_user in array wf_recipients(d.organization_id, 'comptable') loop
    perform push_notification(v_user, 'facture_emise', 'Facture émise',
      format('La facture %s (bon de commande %s) est émise.', v_fac_row.document_number, d.document_number),
      '/documents/' || v_fac, v_fac, false, 'info', document_mail_payload(v_fac));
  end loop;
  if d.commercial_id is not null then
    perform push_notification(d.commercial_id, 'facture_emise', 'Facture émise',
      format('La facture %s de votre bon de commande %s est émise.', v_fac_row.document_number, d.document_number),
      '/documents/' || v_fac, v_fac, false, 'info', document_mail_payload(v_fac));
  end if;
  return v_fac;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.submit_proforma(uuid)',
    'public.validate_proforma(uuid, text)',
    'public.refuse_proforma(uuid, text)',
    'public.mark_proforma_sent(uuid)',
    'public.mark_proforma_accepted(uuid)',
    'public.check_commande(uuid, boolean, text)',
    'public.resubmit_commande(uuid)',
    'public.prepare_invoice(uuid, uuid[])',
    'public.validate_invoice(uuid)',
    'public.refuse_invoice(uuid, text)',
    'public.issue_final_invoice(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- =============================================================================
-- 0044c : conversion et châssis
-- =============================================================================

-- Caractéristiques courtes figées sur les lignes de la facture émise
-- (copie de products.short_specs par issue_final_invoice).
alter table public.document_items add column if not exists short_specs_snapshot text;

-- convert_document : la proforma doit être acceptée par le client ; la
-- facture ne se crée plus que par issue_final_invoice (app.invoice_flow).
-- L'action « à vérifier » de l'ADV est créée par trg_workflow_after.
create or replace function public.convert_document(p_source_id uuid, p_target text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(auth_role()::text, '');
  v_src documents%rowtype;
  v_existing uuid;
  v_number text;
  v_new uuid;
  v_missing text;
begin
  if auth.uid() is null then
    raise exception 'Session expirée, reconnectez-vous.';
  end if;
  if not mfa_satisfied() then
    raise exception 'Double authentification requise.';
  end if;

  select * into v_src from documents where id = p_source_id;
  if v_src.id is null or v_src.organization_id <> auth_org_id() then
    raise exception 'Document introuvable.';
  end if;

  if p_target = 'commande' then
    if v_src.document_type::text not in ('devis', 'proforma') then
      raise exception 'Seule une facture proforma peut être convertie en bon de commande.';
    end if;
    if v_src.commercial_id <> auth.uid()
       and v_role not in ('super_admin', 'administrateur', 'manager', 'responsable_commercial', 'comptable', 'receptionniste_sav', 'admin_ventes') then
      raise exception 'Vous ne pouvez convertir que vos propres factures proforma.';
    end if;
    if v_src.workflow_status is distinct from 'acceptee' then
      raise exception 'La proforma doit être validée puis acceptée par le client avant d''être convertie en bon de commande.';
    end if;
  elsif p_target = 'facture' then
    if v_src.document_type::text <> 'commande' then
      raise exception 'Seule une commande peut être convertie en facture.';
    end if;
    if coalesce(current_setting('app.invoice_flow', true), '') <> 'on' then
      raise exception 'La facture se prépare depuis le bon de commande : vérification ADV, choix du châssis, validation de la direction, puis émission.';
    end if;
    if v_role not in ('super_admin', 'administrateur', 'manager', 'admin_ventes') then
      raise exception 'Seule l''administration des ventes peut établir une facture.';
    end if;
  else
    raise exception 'Conversion non prise en charge.';
  end if;

  if v_src.status::text in ('annule', 'refuse') then
    raise exception 'Ce document est annulé ou refusé : il ne peut pas être converti.';
  end if;

  select id into v_existing from documents
   where parent_document_id = v_src.id and document_type::text = p_target and status::text <> 'annule'
   order by created_at limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  if not exists (select 1 from document_items where document_id = v_src.id) then
    raise exception 'Ce document ne contient aucun article.';
  end if;

  if p_target = 'facture' then
    select string_agg(di.designation, ', ') into v_missing
      from document_items di
     where di.document_id = v_src.id and di.product_id is not null
       and exists (select 1 from vehicle_units u where u.product_id = di.product_id)
       and (select count(*) from document_item_vehicles v where v.document_item_id = di.id and v.removed_at is null) < di.quantity;
    if v_missing is not null then
      raise exception 'Choisissez d''abord le numéro de châssis des véhicules de la commande (%).', split_part(v_missing, E'\n', 1);
    end if;
  end if;

  perform set_config('app.doc_guard_bypass', 'on', true);
  perform set_config('app.workflow_flow', 'on', true);

  insert into documents (organization_id, document_type, document_number, status, client_id, commercial_id,
                         parent_document_id, issue_date, due_date, subtotal, discount_amount, tax_amount, total_amount, notes)
  values (v_src.organization_id, p_target::document_type, null, 'brouillon', v_src.client_id, v_src.commercial_id,
          v_src.id, current_date, (current_date + interval '1 month')::date, v_src.subtotal, v_src.discount_amount,
          v_src.tax_amount, v_src.total_amount, v_src.notes)
  returning id, document_number into v_new, v_number;

  insert into document_items (document_id, product_id, designation, quantity, unit_price, tax_rate, discount_percent, position)
  select v_new, product_id, designation, quantity, unit_price, tax_rate, discount_percent, position
    from document_items where document_id = v_src.id order by position;

  insert into document_item_vehicles (document_id, document_item_id, vehicle_unit_id)
  select v_new, ni.id, v.vehicle_unit_id
    from document_item_vehicles v
    join document_items si on si.id = v.document_item_id
    join document_items ni on ni.document_id = v_new and ni.position = si.position
   where v.document_id = v_src.id and v.removed_at is null;

  update documents set status = 'accepte', updated_at = now()
   where id = v_src.id and status::text not in ('paye', 'paye_partiel');

  perform set_config('app.workflow_flow', 'off', true);
  perform set_config('app.doc_guard_bypass', 'off', true);

  if p_target = 'facture' then
    perform apply_facture_stock(v_new);
  end if;

  return v_new;
end;
$$;

-- set_item_vehicles : sur un bon de commande, le châssis est choisi par
-- l'ADV via prepare_invoice ; sur une facture, seule la direction le corrige.
-- (Corps repris de la version précédente, seules les deux gardes changent.)
create or replace function public.set_item_vehicles(p_item_id uuid, p_unit_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(auth_role()::text, '');
  v_item record;
  v_doc documents%rowtype;
  v_unit record;
  v_other uuid;
  v_ids uuid[] := coalesce(p_unit_ids, '{}');
  v_count integer;
begin
  if auth.uid() is null then raise exception 'Session expirée, reconnectez-vous.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;

  select * into v_item from document_items where id = p_item_id;
  if v_item.id is null then raise exception 'Ligne introuvable.'; end if;
  select * into v_doc from documents where id = v_item.document_id;
  if v_doc.id is null or v_doc.organization_id <> auth_org_id() then raise exception 'Document introuvable.'; end if;
  if v_doc.document_type::text not in ('commande', 'facture') then
    raise exception 'Les châssis se choisissent sur une commande ou une facture.';
  end if;
  if v_doc.document_type::text = 'commande' then
    raise exception 'Sur un bon de commande, le châssis est choisi par l''administration des ventes en préparant la facture.';
  end if;
  if v_role not in ('super_admin', 'administrateur', 'manager') then
    raise exception 'Le châssis d''une facture est fixé à sa préparation : seule la direction peut le corriger.';
  end if;
  if v_doc.status::text in ('annule', 'refuse') then raise exception 'Ce document est annulé.'; end if;

  select count(distinct x) into v_count from unnest(v_ids) x;
  if v_count <> coalesce(array_length(v_ids, 1), 0) then raise exception 'Un même châssis est choisi deux fois.'; end if;
  if v_count > v_item.quantity then
    raise exception 'Cette ligne compte % véhicule(s) : choisissez au plus % châssis.', v_item.quantity::int, v_item.quantity::int;
  end if;

  for v_unit in select * from vehicle_units where id = any (v_ids) loop
    if v_unit.organization_id <> v_doc.organization_id then raise exception 'Véhicule introuvable.'; end if;
    if v_unit.product_id is distinct from v_item.product_id then
      raise exception 'Le châssis % ne correspond pas au modèle de la ligne.', v_unit.vin;
    end if;
    if v_unit.status = 'endommage' or v_unit.status = 'vendu' and v_unit.sold_document_id is distinct from v_doc.id then
      raise exception 'Le châssis % n''est pas disponible (%).', v_unit.vin, v_unit.status;
    end if;
    select vehicle_unit_active_document(v_unit.id) into v_other;
    if v_other is not null and v_other <> v_doc.id and v_other is distinct from v_doc.parent_document_id then
      raise exception 'Le châssis % est déjà attribué à un autre dossier.', v_unit.vin;
    end if;
  end loop;
  if (select count(*) from vehicle_units where id = any (v_ids)) <> v_count then
    raise exception 'Véhicule introuvable.';
  end if;

  update document_item_vehicles set removed_at = now()
   where document_item_id = p_item_id and removed_at is null and not (vehicle_unit_id = any (v_ids));
  insert into document_item_vehicles (document_id, document_item_id, vehicle_unit_id)
  select v_doc.id, p_item_id, x from unnest(v_ids) x
  on conflict (document_item_id, vehicle_unit_id) do update set removed_at = null;

  -- Facture émise : le véhicule est vendu dès l'émission (circuit 0044).
  perform set_config('app.doc_guard_bypass', 'on', true);
  update vehicle_units
     set status = 'vendu', sold_document_id = v_doc.id, sold_at = coalesce(sold_at, now())
   where id = any (v_ids) and (status <> 'vendu' or sold_document_id is distinct from v_doc.id);
  perform set_config('app.doc_guard_bypass', 'off', true);

  return v_count;
end;
$$;

-- =============================================================================
-- 0044d : rôle responsable_commercial (N+1) dans la RLS, lecture comme le
-- manager sur la partie commerciale. (alter policy uniquement.)
-- =============================================================================
-- clients_select : déjà étendu à 'responsable_commercial' par la migration 0046 (fiche client).

alter policy documents_select on public.documents using (
  (organization_id = auth_org_id()) AND (((auth_role())::text = ANY (ARRAY['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes', 'responsable_commercial'])) OR (commercial_id = auth.uid()))
);

alter policy document_items_select on public.document_items using (
  EXISTS (SELECT 1 FROM documents d
           WHERE d.id = document_items.document_id AND d.organization_id = auth_org_id()
             AND (((auth_role())::text = ANY (ARRAY['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes', 'responsable_commercial'])) OR d.commercial_id = auth.uid()))
);

alter policy document_item_vehicles_select on public.document_item_vehicles using (
  EXISTS (SELECT 1 FROM documents d
           WHERE d.id = document_item_vehicles.document_id AND d.organization_id = auth_org_id()
             AND (((auth_role())::text = ANY (ARRAY['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes', 'responsable_commercial'])) OR d.commercial_id = auth.uid()))
);

alter policy document_sendings_select on public.document_sendings using (
  EXISTS (SELECT 1 FROM documents d
           WHERE d.id = document_sendings.document_id AND d.organization_id = auth_org_id()
             AND ((auth_role()::text = ANY (ARRAY['super_admin', 'administrateur', 'manager', 'comptable', 'responsable_commercial'])) OR d.commercial_id = auth.uid()))
);

alter policy payments_select on public.payments using (
  (organization_id = auth_org_id()) AND (((auth_role())::text = ANY (ARRAY['super_admin', 'administrateur', 'comptable', 'manager', 'receptionniste_sav', 'admin_ventes', 'responsable_commercial']))
    OR EXISTS (SELECT 1 FROM documents d WHERE d.id = payments.document_id AND d.commercial_id = auth.uid()))
);

alter policy prospects_select on public.prospects using (
  (organization_id = auth_org_id()) AND (((auth_role())::text = ANY (ARRAY['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes', 'marketing', 'responsable_commercial'])) OR (assigned_to = auth.uid()))
);

alter policy prospect_activities_select on public.prospect_activities using (
  EXISTS (SELECT 1 FROM prospects p
           WHERE p.id = prospect_activities.prospect_id AND p.organization_id = auth_org_id()
             AND (((auth_role())::text = ANY (ARRAY['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes', 'marketing', 'responsable_commercial'])) OR p.assigned_to = auth.uid()))
);

alter policy deals_select on public.deals using (
  (organization_id = auth_org_id()) AND ((assigned_to = auth.uid()) OR ((auth_role())::text = ANY (ARRAY['super_admin', 'administrateur', 'manager', 'admin_ventes', 'chef_service', 'responsable_commercial'])))
);
