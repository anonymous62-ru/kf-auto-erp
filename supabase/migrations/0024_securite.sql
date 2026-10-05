-- Correctifs de sécurité et de fonctionnement (revue complète du 04/10 au soir,
-- avant le démarrage en production). Chaque point a été vérifié sur la vraie
-- base, dans une transaction annulée aussitôt (aucune donnée modifiée).
--
-- 1) CRITIQUE : un utilisateur pouvait se donner le rôle super_admin.
--    La policy profiles_update_self (id = auth.uid()) ne limitait aucune
--    colonne : depuis la console du navigateur, un commercial pouvait
--    faire update profiles set role = 'super_admin'. Testé : ça passait.
--    -> Trigger qui refuse tout changement de rôle / organisation /
--       activation par quelqu'un qui n'est pas administrateur, et toute
--       modification d'un super_admin par quelqu'un qui ne l'est pas.
--
-- 2) CRITIQUE : les fonctions security definer étaient exécutables par un
--    visiteur NON CONNECTÉ (droit EXECUTE donné par défaut au rôle anon).
--    Pour lui, auth_org_id() vaut NULL et les contrôles "<> auth_org_id()"
--    ne bloquent rien : testé, un visiteur pouvait supprimer une facture et
--    ses paiements avec son seul identifiant (présent dans le QR code).
--    -> Retrait du droit à anon sur toutes ces fonctions, sauf
--       get_organization_branding (logo de la page de connexion).
--
-- 3) Un compte désactivé gardait tous ses accès : auth_role() et
--    auth_org_id() ignoraient profiles.is_active. -> ils renvoient NULL pour
--    un compte désactivé, ce qui ferme toutes les policies.
--
-- 4) Un paiement saisi par la caissière, la secrétaire ou le manager ne
--    mettait pas la facture à jour (le trigger n'était pas security definer
--    et la policy documents_update le bloquait en silence) : facture restée
--    "due" et risque de double encaissement. -> security definer, et montant
--    payé recalculé à partir de la somme réelle des paiements.
--
-- 5) Montants et statut "payé" modifiables directement par un commercial
--    (la policy documents_update ne limitait aucune colonne) : un document
--    pouvait apparaître "Payé" sur la page publique de vérification sans
--    aucun paiement. -> Trigger : seuls les paiements (et les
--    administrateurs) changent les montants ; un statut payé ne recule plus
--    (renvoi WhatsApp ou signature d'une facture déjà payée).
--
-- 6) Droits : la caissière, la secrétaire et le manager peuvent désormais
--    signer/marquer envoyé un document et modifier une fiche client (avant :
--    échec silencieux). Création d'une facture à partir du devis d'un
--    commercial possible pour eux (la facture reste au nom du commercial).
--
-- 7) Suppression (demande du 04/10) : réservée à super_admin,
--    administrateur et manager, quel que soit le statut du document. Les
--    commerciaux ne suppriment plus rien.

-- ---------------------------------------------------------------------------
-- 1) Protection des champs sensibles du profil
-- ---------------------------------------------------------------------------
create or replace function protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
begin
  -- Appels serveur avec la clé service_role (gestion des utilisateurs) ou
  -- SQL Editor : pas d'utilisateur connecté, contrôles faits par l'appli.
  if auth.uid() is null then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.organization_id is distinct from old.organization_id
     or new.is_active is distinct from old.is_active
     or new.id is distinct from old.id then
    select role::text into v_caller_role from profiles where id = auth.uid();
    if v_caller_role is null or v_caller_role not in ('super_admin', 'administrateur') then
      raise exception 'Modification non autorisée du rôle ou du statut du compte.';
    end if;
    if new.organization_id is distinct from old.organization_id or new.id is distinct from old.id then
      raise exception 'Changement d''organisation interdit.';
    end if;
    if (old.role::text = 'super_admin' or new.role::text = 'super_admin') and v_caller_role <> 'super_admin' then
      raise exception 'Seul un super admin peut modifier un compte super admin.';
    end if;
    if old.id = auth.uid() and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
      raise exception 'Vous ne pouvez pas modifier votre propre rôle ni désactiver votre propre compte.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile on profiles;
create trigger trg_protect_profile
  before update on profiles
  for each row execute function protect_profile_privileged_fields();

-- ---------------------------------------------------------------------------
-- 2) Aucun accès anonyme aux fonctions security definer
-- ---------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and p.proname not in ('get_organization_branding', 'auth_role', 'auth_org_id')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Comptes désactivés : plus aucun accès aux données
-- ---------------------------------------------------------------------------
create or replace function auth_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid() and coalesce(is_active, true);
$$;

create or replace function auth_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from profiles where id = auth.uid() and coalesce(is_active, true);
$$;

-- ---------------------------------------------------------------------------
-- 4) Paiement -> mise à jour fiable de la facture
-- ---------------------------------------------------------------------------
create or replace function apply_payment_to_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid numeric;
begin
  select coalesce(sum(amount), 0) into v_paid from payments where document_id = new.document_id;
  update documents
     set amount_paid = v_paid,
         status = case
           when v_paid >= total_amount then 'paye'::document_status
           when v_paid > 0 then 'paye_partiel'::document_status
           else status
         end,
         updated_at = now()
   where id = new.document_id;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Montants et statut payé protégés
-- ---------------------------------------------------------------------------
create or replace function protect_document_financials()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  -- Mise à jour faite par le trigger de paiement (profondeur > 1) ou par
  -- un appel serveur sans utilisateur : autorisée.
  if pg_trigger_depth() > 1 or auth.uid() is null then
    return new;
  end if;

  select role::text into v_role from profiles where id = auth.uid();

  if coalesce(v_role, '') not in ('super_admin', 'administrateur') then
    if new.amount_paid is distinct from old.amount_paid
       or new.total_amount is distinct from old.total_amount
       or new.subtotal is distinct from old.subtotal
       or new.tax_amount is distinct from old.tax_amount
       or new.organization_id is distinct from old.organization_id
       or new.commercial_id is distinct from old.commercial_id then
      raise exception 'Les montants d''un document ne peuvent pas être modifiés directement.';
    end if;
    if new.status in ('paye', 'paye_partiel') and new.status is distinct from old.status then
      raise exception 'Le statut payé est mis à jour uniquement par l''enregistrement d''un paiement.';
    end if;
  end if;

  -- Un document payé ne redevient pas "envoyé" ou "accepté" (renvoi par
  -- WhatsApp, signature après paiement...).
  if old.status in ('paye', 'paye_partiel') and new.status in ('brouillon', 'envoye', 'accepte') then
    new.status := old.status;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_document_financials on documents;
create trigger trg_protect_document_financials
  before update on documents
  for each row execute function protect_document_financials();

-- ---------------------------------------------------------------------------
-- 6) et 7) Droits sur documents et clients
-- ---------------------------------------------------------------------------
alter policy documents_update on documents using (
  organization_id = auth_org_id() and (
    auth_role()::text in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav')
    or commercial_id = auth.uid()
  )
);

alter policy documents_insert on documents with check (
  organization_id = auth_org_id() and (
    commercial_id = auth.uid()
    or auth_role()::text in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav')
  )
);

alter policy documents_delete on documents using (
  organization_id = auth_org_id()
  and auth_role()::text in ('super_admin', 'administrateur', 'manager')
);

alter policy clients_update on clients using (
  organization_id = auth_org_id() and (
    auth_role()::text in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav')
    or assigned_to = auth.uid()
  )
);

-- Un client créé est rattaché à son créateur, sauf pour la direction et
-- l'accueil qui peuvent l'attribuer à un commercial.
alter policy clients_insert on clients with check (
  organization_id = auth_org_id() and (
    assigned_to = auth.uid()
    or auth_role()::text in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav')
  )
);
