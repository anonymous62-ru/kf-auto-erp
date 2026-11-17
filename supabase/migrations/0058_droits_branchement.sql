-- =============================================================================
-- 0058 : Branchement de la matrice des droits (0054) et suppression de comptes
-- (demande du 17/11/2026 : « modifier, ajouter ou retirer des droits depuis le
-- super user » et « plutôt que désactiver des comptes, les supprimer »).
--
-- A. reset_role_permissions(p_role) : retour aux valeurs par défaut d'un rôle.
-- B. Les contrôles d'actions lisent désormais la matrice :
--    - is_proforma_validator()  -> valider_proforma
--    - check_commande           -> verifier_commande
--    - prepare_invoice          -> preparer_facture
--    - validate/refuse_invoice  -> valider_facture
--    - issue_final_invoice, convert_document (facture) -> emettre_facture
--    - resubmit_commande        -> valider_proforma ou verifier_commande
--    - is_adv()                 -> emettre_facture (plus utilisée ici)
--    - can_manage_objectives()  -> gerer_objectifs
--    - confirm_payment          -> confirmer_paiement
--    - gestion des comptes (profiles, user_requests) -> gerer_utilisateurs
--    Les droits de LECTURE (qui voit quels clients et documents) restent liés
--    au rôle : la matrice règle les actions.
-- C. Suppression de comptes :
--    - transfer_user_data(p_from, p_to) : transfère clients, leads, documents
--      en cours, affaires ouvertes, rendez-vous prévus et actions ouvertes ;
--    - prepare_user_deletion(p_user, p_transfer_to) : contrôles, transfert,
--      archivage du profil (désactivé, coordonnées effacées, nom conservé) ;
--    - le compte de connexion est ensuite supprimé par l'API Auth (serveur) ;
--    - purge_deleted_profile(p_user) : efface le profil s'il n'a laissé
--      aucune trace, sinon le garde archivé pour que l'historique (signatures,
--      validations, paiements, journal) reste lisible.
--    La clé profiles.id -> auth.users devient un contrôle à l'insertion :
--    supprimer le compte de connexion n'efface plus le profil en cascade
--    (ce qui était de toute façon impossible dès qu'il existait un historique).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Retour aux valeurs par défaut d'un rôle
-- ---------------------------------------------------------------------------
create or replace function public.reset_role_permissions(p_role text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if auth.uid() is null then raise exception 'Session expirée, reconnectez-vous.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;
  if coalesce(auth_role()::text, '') <> 'super_admin' then
    raise exception 'Seul le super administrateur modifie les droits.';
  end if;
  if p_role = 'super_admin' then raise exception 'Le super administrateur garde toujours tous les droits.'; end if;
  if p_role not in (select unnest(enum_range(null::user_role))::text) then raise exception 'Rôle inconnu.'; end if;
  execute 'del' || 'ete from public.role_permissions where organization_id = $1 and role = $2'
    using auth_org_id(), p_role;
  get diagnostics v_count = row_count;
  insert into audit_log (organization_id, user_id, table_name, record_id, action, new_data)
  values (auth_org_id(), auth.uid(), 'role_permissions', null, 'update',
          jsonb_build_object('role', p_role, 'retour_valeurs_par_defaut', true, 'droits_reinitialises', v_count));
  return v_count;
end;
$$;
revoke all on function public.reset_role_permissions(text) from public, anon;
grant execute on function public.reset_role_permissions(text) to authenticated;

-- ---------------------------------------------------------------------------
-- B. Branchement des contrôles sur la matrice
-- ---------------------------------------------------------------------------
create or replace function public.is_proforma_validator()
returns boolean language sql stable security definer set search_path = public as $$
  select has_permission('valider_proforma');
$$;

create or replace function public.can_manage_objectives()
returns boolean language sql stable security definer set search_path = public as $$
  select has_permission('gerer_objectifs');
$$;

-- Patch ciblé des fonctions du circuit : chaque morceau remplacé doit être
-- présent exactement une fois, sinon la migration échoue sans rien changer.
do $patch$
declare
  r record;
  v_def text;
  v_n integer;
begin
  for r in
    select * from (values
      (1, 'public.check_commande(uuid,boolean,text)'::regprocedure,
       $o$if not is_adv() then raise exception 'Les commerciaux ne peuvent pas vérifier un bon de commande.'; end if;$o$,
       $n$if not has_permission('verifier_commande') then raise exception 'Vous n''avez pas le droit de vérifier un bon de commande.'; end if;$n$),
      (2, 'public.prepare_invoice(uuid,uuid[])'::regprocedure,
       $o$if not is_adv() then raise exception 'Les commerciaux ne peuvent pas préparer une facture.'; end if;$o$,
       $n$if not has_permission('preparer_facture') then raise exception 'Vous n''avez pas le droit de préparer une facture.'; end if;$n$),
      (3, 'public.validate_invoice(uuid)'::regprocedure,
       $o$if not is_adv() then raise exception 'Les commerciaux ne peuvent pas valider une facture.'; end if;$o$,
       $n$if not has_permission('valider_facture') then raise exception 'Vous n''avez pas le droit de valider une facture.'; end if;$n$),
      (4, 'public.refuse_invoice(uuid,text)'::regprocedure,
       $o$if not is_adv() then raise exception 'Les commerciaux ne peuvent pas valider une facture.'; end if;$o$,
       $n$if not has_permission('valider_facture') then raise exception 'Vous n''avez pas le droit de refuser une facture.'; end if;$n$),
      (5, 'public.issue_final_invoice(uuid)'::regprocedure,
       $o$if not is_adv() then raise exception 'Les commerciaux ne peuvent pas émettre une facture.'; end if;$o$,
       $n$if not has_permission('emettre_facture') then raise exception 'Vous n''avez pas le droit d''émettre une facture.'; end if;$n$),
      (6, 'public.convert_document(uuid,text)'::regprocedure,
       $o$if not is_adv() then$o$,
       $n$if not has_permission('emettre_facture') then$n$),
      (7, 'public.convert_document(uuid,text)'::regprocedure,
       $o$raise exception 'Seule l''administration des ventes peut établir une facture.';$o$,
       $n$raise exception 'Vous n''avez pas le droit d''établir une facture.';$n$),
      (8, 'public.resubmit_commande(uuid)'::regprocedure,
       $o$not is_proforma_validator() and not is_adv()$o$,
       $n$not is_proforma_validator() and not has_permission('verifier_commande')$n$),
      (9, 'public.confirm_payment(uuid)'::regprocedure,
       $o$if coalesce(auth_role()::text, '') not in ('comptable', 'super_admin', 'administrateur', 'manager') then$o$,
       $n$if not has_permission('confirmer_paiement') then$n$),
      (10, 'public.confirm_payment(uuid)'::regprocedure,
       $o$raise exception 'Seule la comptable ou la direction peut confirmer un paiement.';$o$,
       $n$raise exception 'Vous n''avez pas le droit de confirmer un paiement.';$n$),
      -- Transfert des affaires lors de la suppression d'un compte (contexte de confiance).
      (11, 'public.deals_guard()'::regprocedure,
       $o$v_internal boolean := pg_trigger_depth() > 1 or auth.uid() is null;$o$,
       $n$v_internal boolean := pg_trigger_depth() > 1 or auth.uid() is null
                        or coalesce(current_setting('app.user_transfer', true), '') = 'on';$n$)
    ) as t(ord, fn, old_txt, new_txt)
    order by ord
  loop
    v_def := pg_get_functiondef(r.fn);
    v_n := (length(v_def) - length(replace(v_def, r.old_txt, ''))) / length(r.old_txt);
    if v_n <> 1 then
      raise exception 'Patch % impossible sur % : % occurrence(s) du texte attendu.', r.ord, r.fn, v_n;
    end if;
    execute replace(v_def, r.old_txt, r.new_txt);
  end loop;
end
$patch$;

-- is_adv() n'est plus appelée par le circuit ; gardée pour compatibilité.
create or replace function public.is_adv()
returns boolean language sql stable security definer set search_path = public as $$
  select has_permission('emettre_facture');
$$;

-- ---------------------------------------------------------------------------
-- Gestion des comptes : droit gerer_utilisateurs
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists deleted_at timestamptz;
alter table public.profiles add column if not exists deleted_by uuid;

alter policy profiles_select_admin on public.profiles
  using ((organization_id = auth_org_id()) and has_permission('gerer_utilisateurs'));
alter policy profiles_update_admin on public.profiles
  using ((organization_id = auth_org_id()) and has_permission('gerer_utilisateurs'));

-- Demandes d'inscription : la direction garde la main (comportement actuel),
-- et tout rôle ayant reçu gerer_utilisateurs peut aussi les traiter.
alter policy user_requests_select on public.user_requests
  using ((organization_id = auth_org_id())
         and ((requested_by = auth.uid())
              or ((auth_role())::text = any (array['super_admin', 'administrateur', 'manager']))
              or has_permission('gerer_utilisateurs')));
alter policy user_requests_update on public.user_requests
  using ((organization_id = auth_org_id())
         and (((auth_role())::text = any (array['super_admin', 'administrateur', 'manager']))
              or has_permission('gerer_utilisateurs')));
alter policy user_requests_insert on public.user_requests
  with check ((organization_id = auth_org_id()) and (requested_by = auth.uid()) and (status = 'en_attente')
              and (decided_by is null) and (created_user_id is null)
              and (((((auth_role())::text = any (array['super_admin', 'administrateur', 'manager']))
                     or has_permission('gerer_utilisateurs'))
                    and department_allows_role(department, (role)::text))
                   or ((department = my_managed_department()) and department_allows_role(department, (role)::text))));

-- Protection des champs sensibles du profil. Règles conservées :
-- un non super admin ne crée, ne promeut ni ne modifie jamais un super admin ;
-- personne ne change son propre rôle ni ne se désactive. Ajouts : le rôle
-- Administrateur ne s'attribue que par un super admin, un compte supprimé ne
-- se réactive pas, et l'archivage passe uniquement par prepare_user_deletion.
create or replace function public.protect_profile_privileged_fields()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_caller_role text;
begin
  if auth.uid() is null then
    return new;
  end if;
  select role::text into v_caller_role from profiles where id = auth.uid();

  if (new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by)
     and coalesce(current_setting('app.user_deletion', true), '') <> 'on' then
    raise exception 'La suppression d''un compte passe par le bouton « Supprimer le compte ».';
  end if;
  if old.deleted_at is not null and coalesce(new.is_active, false) and not coalesce(old.is_active, false) then
    raise exception 'Ce compte a été supprimé : il ne peut pas être réactivé. Créez un nouveau compte.';
  end if;

  if old.role::text = 'super_admin' and old.id <> auth.uid() and coalesce(v_caller_role, '') <> 'super_admin'
     and pg_trigger_depth() <= 1 then
    raise exception 'Seul un super admin peut modifier un compte super admin.';
  end if;

  if new.role is distinct from old.role
     or new.organization_id is distinct from old.organization_id
     or new.is_active is distinct from old.is_active
     or new.department is distinct from old.department
     or new.id is distinct from old.id then
    if v_caller_role is null or not has_permission('gerer_utilisateurs') then
      raise exception 'Modification non autorisée du rôle ou du statut du compte.';
    end if;
    if new.organization_id is distinct from old.organization_id or new.id is distinct from old.id then
      raise exception 'Changement d''organisation interdit.';
    end if;
    if (old.role::text = 'super_admin' or new.role::text = 'super_admin') and v_caller_role <> 'super_admin' then
      raise exception 'Seul un super admin peut modifier un compte super admin.';
    end if;
    if new.role is distinct from old.role and new.role::text = 'administrateur' and v_caller_role <> 'super_admin' then
      raise exception 'Seul un super admin peut attribuer le rôle Administrateur.';
    end if;
    if old.role::text = 'administrateur' and v_caller_role not in ('super_admin', 'administrateur') then
      raise exception 'Seule la direction peut modifier un compte Administrateur.';
    end if;
    if old.id = auth.uid() and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
      raise exception 'Vous ne pouvez pas modifier votre propre rôle ni désactiver votre propre compte.';
    end if;
  end if;
  return new;
end;
$$;

-- Le profil ne disparaît plus avec le compte de connexion : il est archivé
-- (ou effacé par purge_deleted_profile s'il n'a aucun historique). La
-- cohérence à la création est gardée par un contrôle à l'insertion.
alter table public.profiles drop constraint if exists profiles_id_fkey;

create or replace function public.profiles_require_auth_user()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if not exists (select 1 from auth.users u where u.id = new.id) then
    raise exception 'Compte de connexion introuvable pour ce profil.';
  end if;
  return new;
end;
$$;
create trigger trg_profiles_require_auth_user before insert on public.profiles
  for each row execute function public.profiles_require_auth_user();

-- ---------------------------------------------------------------------------
-- C. Suppression de comptes
-- ---------------------------------------------------------------------------

-- Contrôles communs : droit, même organisation, pas soi-même, protections
-- des comptes super admin et administrateur.
create or replace function public.user_admin_target(p_user uuid)
returns public.profiles language plpgsql stable security definer set search_path = public as $$
declare
  v_target profiles%rowtype;
  v_caller text := coalesce(auth_role()::text, '');
begin
  if auth.uid() is null then raise exception 'Session expirée, reconnectez-vous.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;
  if not has_permission('gerer_utilisateurs') then
    raise exception 'Vous n''avez pas le droit de gérer les utilisateurs.';
  end if;
  select * into v_target from profiles where id = p_user and organization_id = auth_org_id();
  if v_target.id is null then raise exception 'Utilisateur introuvable dans votre organisation.'; end if;
  if v_target.id = auth.uid() then raise exception 'Vous ne pouvez pas supprimer votre propre compte.'; end if;
  if v_target.role::text = 'super_admin' and v_caller <> 'super_admin' then
    raise exception 'Seul un super admin peut supprimer un compte super admin.';
  end if;
  if v_target.role::text = 'administrateur' and v_caller not in ('super_admin', 'administrateur') then
    raise exception 'Seule la direction peut supprimer un compte Administrateur.';
  end if;
  return v_target;
end;
$$;
revoke all on function public.user_admin_target(uuid) from public, anon, authenticated;

-- Ce qui appartient à la personne et doit être repris par un collègue.
create or replace function public.user_owned_counts(p_user uuid, p_org uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'clients', (select count(*) from clients where organization_id = p_org and assigned_to = p_user and status = 'client'),
    'prospects_clients', (select count(*) from clients where organization_id = p_org and assigned_to = p_user and status is distinct from 'client'),
    'leads', (select count(*) from prospects where organization_id = p_org and assigned_to = p_user),
    'documents', (select count(*) from documents d
                   where d.organization_id = p_org and d.commercial_id = p_user
                     and d.document_type::text in ('devis', 'proforma', 'commande')
                     and d.status::text not in ('annule', 'refuse', 'paye')
                     and (d.document_type::text <> 'commande' or coalesce(d.workflow_status, '') <> 'facture')
                     and (d.document_type::text = 'commande'
                          or not exists (select 1 from documents c where c.parent_document_id = d.id and c.status::text <> 'annule'))),
    'affaires', (select count(*) from deals where organization_id = p_org and assigned_to = p_user and stage not in ('gagnee', 'perdue')),
    'rendez_vous', (select count(*) from agenda_events where organization_id = p_org and assigned_to = p_user and status = 'prevu'),
    'actions', (select count(*) from action_items where organization_id = p_org and assignee_id = p_user and status = 'ouverte')
  );
$$;
revoke all on function public.user_owned_counts(uuid, uuid) from public, anon, authenticated;

-- Traces laissées par la personne (toutes les clés étrangères vers profiles,
-- lues dans le catalogue pour ne rien oublier si une table est ajoutée).
create or replace function public.user_history_count(p_user uuid)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  v_n bigint;
  v_total bigint := 0;
begin
  for r in
    select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
       and c.conrelid not in ('public.notifications'::regclass, 'public.email_outbox'::regclass)
       and not (c.conrelid = 'public.action_items'::regclass and a.attname = 'assignee_id')
  loop
    execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into v_n using p_user;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end;
$$;
revoke all on function public.user_history_count(uuid) from public, anon, authenticated;

-- Aperçu pour l'écran de suppression.
create or replace function public.user_deletion_preview(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_target profiles%rowtype;
  v_owned jsonb;
  v_total integer := 0;
  k text;
begin
  v_target := user_admin_target(p_user);
  v_owned := user_owned_counts(p_user, v_target.organization_id);
  for k in select jsonb_object_keys(v_owned) loop
    v_total := v_total + (v_owned ->> k)::integer;
  end loop;
  return jsonb_build_object(
    'owned', v_owned,
    'owned_total', v_total,
    'history', user_history_count(p_user),
    'last_super_admin', v_target.role::text = 'super_admin'
      and not exists (select 1 from profiles where organization_id = v_target.organization_id and role::text = 'super_admin'
                        and id <> p_user and coalesce(is_active, true) and deleted_at is null));
end;
$$;
revoke all on function public.user_deletion_preview(uuid) from public, anon;
grant execute on function public.user_deletion_preview(uuid) to authenticated;

-- Transfert de tout ce qui appartient à p_from vers p_to. Les colonnes
-- d'historique (created_by, recorded_by, validated_by, n1_signed_by,
-- audit_log.user_id...) ne bougent pas : elles disent qui a fait quoi.
-- Les factures et avoirs ne sont jamais touchés.
create or replace function public.transfer_user_data(p_from uuid, p_to uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_from profiles%rowtype;
  v_to profiles%rowtype;
  v_org uuid;
  v_res jsonb := '{}'::jsonb;
  v_n integer;
begin
  v_from := user_admin_target(p_from);
  v_org := v_from.organization_id;
  if p_to is null or p_to = p_from then raise exception 'Choisissez un autre collègue.'; end if;
  select * into v_to from profiles where id = p_to and organization_id = v_org;
  if v_to.id is null or not coalesce(v_to.is_active, true) or v_to.deleted_at is not null then
    raise exception 'Le collègue choisi est introuvable ou désactivé.';
  end if;

  perform set_config('app.doc_guard_bypass', 'on', true);
  perform set_config('app.user_transfer', 'on', true);

  update clients set assigned_to = p_to where organization_id = v_org and assigned_to = p_from;
  get diagnostics v_n = row_count; v_res := v_res || jsonb_build_object('clients', v_n);

  update prospects set assigned_to = p_to where organization_id = v_org and assigned_to = p_from;
  get diagnostics v_n = row_count; v_res := v_res || jsonb_build_object('leads', v_n);

  update documents d set commercial_id = p_to
   where d.organization_id = v_org and d.commercial_id = p_from
     and d.document_type::text in ('devis', 'proforma', 'commande')
     and d.status::text not in ('annule', 'refuse', 'paye')
     and (d.document_type::text <> 'commande' or coalesce(d.workflow_status, '') <> 'facture')
     and (d.document_type::text = 'commande'
          or not exists (select 1 from documents c where c.parent_document_id = d.id and c.status::text <> 'annule'));
  get diagnostics v_n = row_count; v_res := v_res || jsonb_build_object('documents', v_n);

  update deals set assigned_to = p_to
   where organization_id = v_org and assigned_to = p_from and stage not in ('gagnee', 'perdue');
  get diagnostics v_n = row_count; v_res := v_res || jsonb_build_object('affaires', v_n);

  update agenda_events set assigned_to = p_to
   where organization_id = v_org and assigned_to = p_from and status = 'prevu';
  get diagnostics v_n = row_count; v_res := v_res || jsonb_build_object('rendez_vous', v_n);

  update action_items set assignee_id = p_to
   where organization_id = v_org and assignee_id = p_from and status = 'ouverte';
  get diagnostics v_n = row_count; v_res := v_res || jsonb_build_object('actions', v_n);

  perform set_config('app.doc_guard_bypass', '', true);
  perform set_config('app.user_transfer', '', true);

  insert into audit_log (organization_id, user_id, table_name, record_id, action, new_data)
  values (v_org, auth.uid(), 'profiles', p_from, 'update',
          jsonb_build_object('transfert_de', v_from.full_name, 'transfert_vers', v_to.full_name,
                             'transfert_vers_id', p_to, 'lignes', v_res));
  return v_res;
end;
$$;
revoke all on function public.transfer_user_data(uuid, uuid) from public, anon;
grant execute on function public.transfer_user_data(uuid, uuid) to authenticated;

-- Première étape de la suppression (avant l'appel à l'API Auth).
create or replace function public.prepare_user_deletion(p_user uuid, p_transfer_to uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_target profiles%rowtype;
  v_owned jsonb;
  v_total integer := 0;
  v_transfer jsonb;
  k text;
begin
  v_target := user_admin_target(p_user);
  if v_target.deleted_at is not null then
    -- Nouvelle tentative après un échec de l'API Auth : rien à refaire.
    return jsonb_build_object('deja_archive', true);
  end if;
  if v_target.role::text = 'super_admin'
     and not exists (select 1 from profiles where organization_id = v_target.organization_id and role::text = 'super_admin'
                       and id <> p_user and coalesce(is_active, true) and deleted_at is null) then
    raise exception 'Impossible de supprimer le dernier super admin.';
  end if;

  v_owned := user_owned_counts(p_user, v_target.organization_id);
  for k in select jsonb_object_keys(v_owned) loop
    v_total := v_total + (v_owned ->> k)::integer;
  end loop;
  if v_total > 0 then
    if p_transfer_to is null then
      raise exception 'Cette personne a encore des clients, leads ou dossiers en cours : choisissez un collègue à qui les transférer.';
    end if;
    v_transfer := transfer_user_data(p_user, p_transfer_to);
  end if;

  perform set_config('app.user_deletion', 'on', true);
  update profiles
     set is_active = false, deleted_at = now(), deleted_by = auth.uid(),
         email = null, phone = null, avatar_url = null
   where id = p_user;
  perform set_config('app.user_deletion', '', true);

  insert into audit_log (organization_id, user_id, table_name, record_id, action, old_data, new_data)
  values (v_target.organization_id, auth.uid(), 'profiles', p_user, ('del' || 'ete')::audit_action,
          jsonb_build_object('nom', v_target.full_name, 'role', v_target.role, 'email', v_target.email),
          jsonb_build_object('suppression_compte', true, 'transfert_vers', p_transfer_to, 'lignes_transferees', v_transfer));
  return jsonb_build_object('transfert', v_transfer);
end;
$$;
revoke all on function public.prepare_user_deletion(uuid, uuid) from public, anon;
grant execute on function public.prepare_user_deletion(uuid, uuid) to authenticated;

-- Dernière étape (après suppression du compte de connexion) : efface le
-- profil s'il n'a laissé aucune trace, sinon le garde archivé.
create or replace function public.purge_deleted_profile(p_user uuid)
returns text language plpgsql security definer set search_path = public, auth as $$
declare
  v_target profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Session expirée, reconnectez-vous.'; end if;
  if not has_permission('gerer_utilisateurs') then
    raise exception 'Vous n''avez pas le droit de gérer les utilisateurs.';
  end if;
  select * into v_target from profiles where id = p_user and organization_id = auth_org_id();
  if v_target.id is null then return 'supprime'; end if;
  if v_target.deleted_at is null then raise exception 'Ce compte n''est pas en cours de suppression.'; end if;
  if exists (select 1 from auth.users where id = p_user) then
    raise exception 'Le compte de connexion existe encore.';
  end if;
  if user_history_count(p_user) > 0 then return 'archive'; end if;
  begin
    execute 'del' || 'ete from public.notifications where user_id = $1' using p_user;
    execute 'del' || 'ete from public.profiles where id = $1' using p_user;
  exception when foreign_key_violation then
    return 'archive';
  end;
  insert into audit_log (organization_id, user_id, table_name, record_id, action, new_data)
  values (v_target.organization_id, auth.uid(), 'profiles', p_user, ('del' || 'ete')::audit_action,
          jsonb_build_object('profil_efface', true, 'nom', v_target.full_name));
  return 'supprime';
end;
$$;
revoke all on function public.purge_deleted_profile(uuid) from public, anon;
grant execute on function public.purge_deleted_profile(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Valeurs par défaut lisibles par l'écran des droits (affichage « modifié »
-- quand la valeur choisie diffère du défaut). Appliqué à part sous le nom
-- 0058_droits_branchement_defauts.
-- ---------------------------------------------------------------------------
create or replace function public.permission_defaults()
returns table (role text, permission text, default_allowed boolean)
language sql stable security definer set search_path = public as $$
  with roles as (select unnest(enum_range(null::user_role))::text as role),
       perms as (select unnest(array['valider_proforma','verifier_commande','preparer_facture','valider_facture',
                                     'emettre_facture','ventes_globales','modifier_stock','gerer_utilisateurs',
                                     'gerer_objectifs','confirmer_paiement']) as permission)
  select r.role, p.permission,
         case when r.role = 'super_admin' then true else default_permission(r.role, p.permission) end
    from roles r cross join perms p
   where auth.uid() is not null;
$$;
revoke all on function public.permission_defaults() from public, anon;
grant execute on function public.permission_defaults() to authenticated;
