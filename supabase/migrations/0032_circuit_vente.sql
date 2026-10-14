-- Retours de la direction du 09/10/2026, étape 1.
--
--  1. Circuit : Facture proforma (ex-devis, préfixe FP) -> Commande (CMD) -> Facture (FAC).
--     Seule l'administratrice des ventes (et la direction en secours) facture.
--  2. Prospect -> client au PREMIER versement, avec un numéro client unique.
--  3. Un commercial voit les ventes de tout le monde (véhicule, montant,
--     commercial, date, nom du client) sans les coordonnées des clients des autres.
--  4. Demandes d'inscription par les chefs de service, validées par la direction.
--
-- Groupes de rôles utilisés ci-dessous :
--   direction   : super_admin, administrateur, manager
--   facturation : direction + admin_ventes
--   vue large   : direction + comptable + receptionniste_sav + admin_ventes

-- ---------------------------------------------------------------------------
-- Numérotation : devis -> FP (facture proforma), commande -> CMD
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

-- ---------------------------------------------------------------------------
-- Profils : département (pour les chefs de service et les demandes d'inscription)
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists department text;

create or replace function public.protect_profile_privileged_fields()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_caller_role text;
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.organization_id is distinct from old.organization_id
     or new.is_active is distinct from old.is_active
     or new.department is distinct from old.department
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

-- ---------------------------------------------------------------------------
-- Clients : statut prospect / client et numéro client
-- ---------------------------------------------------------------------------
alter table clients add column if not exists status text not null default 'prospect';
alter table clients add column if not exists client_number text;
alter table clients add column if not exists client_since timestamptz;
do $$ begin
  alter table clients add constraint clients_status_check check (status in ('prospect', 'client'));
exception when duplicate_object then null; end $$;
create unique index if not exists clients_org_number_uidx on clients (organization_id, client_number) where client_number is not null;
create index if not exists clients_org_status_idx on clients (organization_id, status);

create table if not exists client_number_counters (
  organization_id uuid primary key references organizations(id),
  last_number integer not null default 0
);
alter table client_number_counters enable row level security;
-- Aucune policy : seule la fonction ci-dessous (security definer) y écrit.

create or replace function public.clients_status_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_internal boolean := pg_trigger_depth() > 1 or auth.uid() is null
                        or coalesce(current_setting('app.doc_guard_bypass', true), '') = 'on';
  v_role text := coalesce(auth_role()::text, '');
  v_next integer;
begin
  if not v_internal then
    -- Le numéro client n'est jamais saisi à la main.
    if tg_op = 'INSERT' then
      new.client_number := null;
      new.client_since := null;
    elsif new.client_number is distinct from old.client_number or new.client_since is distinct from old.client_since then
      raise exception 'Le numéro client est attribué automatiquement.';
    end if;

    -- Passage en client sans paiement : réservé aux services qui reçoivent des
    -- clients déjà acquis (atelier, caisse, administration des ventes, direction).
    if new.status = 'client' and (tg_op = 'INSERT' or old.status <> 'client')
       and v_role not in ('super_admin', 'administrateur', 'manager', 'admin_ventes', 'comptable', 'receptionniste_sav', 'chef_atelier') then
      raise exception 'Un prospect devient client automatiquement à son premier versement.';
    end if;

    if tg_op = 'UPDATE' and old.status = 'client' and new.status <> 'client'
       and v_role not in ('super_admin', 'administrateur', 'manager') then
      raise exception 'Seule la direction peut repasser un client en prospect.';
    end if;
  end if;

  if new.status = 'client' and new.client_number is null then
    insert into client_number_counters (organization_id, last_number)
    values (new.organization_id, 1)
    on conflict (organization_id) do update set last_number = client_number_counters.last_number + 1
    returning last_number into v_next;
    new.client_number := 'CLI-' || lpad(v_next::text, 6, '0');
    new.client_since := coalesce(new.client_since, now());
  end if;
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_clients_status_guard') then
    create trigger trg_clients_status_guard before insert or update on clients
  for each row execute function clients_status_guard();
  end if;
end $$;

-- Premier versement : le prospect devient client (numéro attribué par le
-- trigger ci-dessus), le lead d'origine passe en "converti", le commercial
-- est prévenu.
create or replace function public.promote_client_on_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_doc record;
  v_client record;
begin
  select id, organization_id, client_id, commercial_id into v_doc from documents where id = new.document_id;
  if v_doc.client_id is null then
    return new;
  end if;

  update clients set status = 'client', updated_at = now()
   where id = v_doc.client_id and status = 'prospect'
  returning id, client_number, coalesce(nullif(company_name, ''), trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) as name
    into v_client;

  if v_client.id is not null then
    update prospects set status = 'converti', updated_at = now()
     where client_id = v_client.id and status <> 'converti';
    if v_doc.commercial_id is not null then
      insert into notifications (organization_id, user_id, type, title, message, related_document_id)
      values (v_doc.organization_id, v_doc.commercial_id, 'nouveau_client', 'Nouveau client',
              format('%s est maintenant client (%s) après son premier versement.', coalesce(nullif(v_client.name, ''), 'Le prospect'), v_client.client_number),
              v_doc.id);
    end if;
  end if;
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_promote_client_on_payment') then
    create trigger trg_promote_client_on_payment after insert on payments
  for each row execute function promote_client_on_payment();
  end if;
end $$;

-- Les clients ayant déjà payé deviennent clients (données existantes).
update clients c set status = 'client'
 where c.status = 'prospect'
   and exists (select 1 from documents d join payments p on p.document_id = d.id where d.client_id = c.id);

-- ---------------------------------------------------------------------------
-- Policies : administratrice des ventes, marketing, facturation réservée
-- ---------------------------------------------------------------------------
alter policy clients_select on clients using (
  organization_id = auth_org_id() and (
    auth_role()::text = any (array['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'chef_atelier', 'admin_ventes'])
    or assigned_to = auth.uid()));
alter policy clients_insert on clients with check (
  organization_id = auth_org_id() and (
    assigned_to = auth.uid()
    or auth_role()::text = any (array['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes'])));
alter policy clients_update on clients using (
  organization_id = auth_org_id() and (
    auth_role()::text = any (array['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes'])
    or assigned_to = auth.uid()));

alter policy documents_select on documents using (
  organization_id = auth_org_id() and (
    auth_role()::text = any (array['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes'])
    or commercial_id = auth.uid()));
-- Une facture ne peut être créée que par la facturation (règle du 09/10).
alter policy documents_insert on documents with check (
  organization_id = auth_org_id()
  and (commercial_id = auth.uid()
       or auth_role()::text = any (array['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes']))
  and (document_type::text <> 'facture'
       or auth_role()::text = any (array['super_admin', 'administrateur', 'manager', 'admin_ventes'])));
alter policy documents_update on documents using (
  organization_id = auth_org_id() and (
    auth_role()::text = any (array['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes'])
    or commercial_id = auth.uid()));

alter policy document_items_select on document_items using (
  exists (select 1 from documents d
           where d.id = document_items.document_id and d.organization_id = auth_org_id()
             and (auth_role()::text = any (array['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes'])
                  or d.commercial_id = auth.uid())));
alter policy document_items_insert on document_items with check (
  exists (select 1 from documents d
           where d.id = document_items.document_id and d.organization_id = auth_org_id()
             and (auth_role()::text = any (array['super_admin', 'administrateur', 'manager', 'admin_ventes'])
                  or d.commercial_id = auth.uid())));

alter policy payments_select on payments using (
  organization_id = auth_org_id() and (
    auth_role()::text = any (array['super_admin', 'administrateur', 'comptable', 'manager', 'receptionniste_sav', 'admin_ventes'])
    or exists (select 1 from documents d where d.id = payments.document_id and d.commercial_id = auth.uid())));

alter policy profiles_select_team on profiles using (
  organization_id = auth_org_id() and
  auth_role()::text = any (array['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'chef_atelier', 'admin_ventes']));

-- Leads (table prospects) : la chargée marketing voit et alimente tous les leads.
alter policy prospects_select on prospects using (
  organization_id = auth_org_id() and (
    auth_role()::text = any (array['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes', 'marketing'])
    or assigned_to = auth.uid()));
alter policy prospects_insert on prospects with check (
  organization_id = auth_org_id() and (
    auth_role()::text = any (array['super_admin', 'administrateur', 'manager', 'marketing'])
    or assigned_to = auth.uid()));
alter policy prospects_update on prospects using (
  organization_id = auth_org_id() and (
    auth_role()::text = any (array['super_admin', 'administrateur', 'manager', 'marketing'])
    or assigned_to = auth.uid()));
alter policy prospect_activities_select on prospect_activities using (
  exists (select 1 from prospects p
           where p.id = prospect_activities.prospect_id and p.organization_id = auth_org_id()
             and (auth_role()::text = any (array['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes', 'marketing'])
                  or p.assigned_to = auth.uid())));
alter policy prospect_activities_insert on prospect_activities with check (
  exists (select 1 from prospects p
           where p.id = prospect_activities.prospect_id and p.organization_id = auth_org_id()
             and (auth_role()::text = any (array['super_admin', 'administrateur', 'manager', 'marketing'])
                  or p.assigned_to = auth.uid())));

-- Le type d'un document ne change jamais (une conversion crée un nouveau document).
create or replace function public.protect_document_financials()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  if new.document_type is distinct from old.document_type
     and coalesce(current_setting('app.doc_guard_bypass', true), '') <> 'on' then
    raise exception 'Le type d''un document ne peut pas être modifié : utilisez la conversion.';
  end if;

  if pg_trigger_depth() > 1 or auth.uid() is null
     or coalesce(current_setting('app.doc_guard_bypass', true), '') = 'on' then
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

  if old.status in ('paye', 'paye_partiel') and new.status in ('brouillon', 'envoye', 'accepte') then
    new.status := old.status;
  end if;

  return new;
end;
$$;

-- Déduction du stock : l'administratrice des ventes facture pour le compte des commerciaux.
create or replace function public.apply_facture_stock(p_document_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_doc record;
  v_item record;
  v_count integer := 0;
begin
  select id, organization_id, document_type, document_number, commercial_id
    into v_doc from documents where id = p_document_id;

  if v_doc.id is null or v_doc.organization_id <> auth_org_id() then
    raise exception 'Document introuvable';
  end if;
  if v_doc.document_type <> 'facture' then
    return 0;
  end if;
  if v_doc.commercial_id <> auth.uid()
     and auth_role()::text not in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes') then
    raise exception 'Accès refusé à ce document';
  end if;

  if exists (select 1 from stock_movements where reference_document_id = p_document_id and movement_type = 'sortie') then
    return 0;
  end if;

  for v_item in
    select di.product_id, sum(di.quantity) as quantity
      from document_items di
      join products p on p.id = di.product_id and p.organization_id = v_doc.organization_id
     where di.document_id = p_document_id and di.product_id is not null
     group by di.product_id
  loop
    update products set quantity_on_hand = coalesce(quantity_on_hand, 0) - v_item.quantity, updated_at = now()
     where id = v_item.product_id;
    insert into stock_movements (organization_id, product_id, movement_type, quantity, reason, reference_document_id, performed_by)
    values (v_doc.organization_id, v_item.product_id, 'sortie', -v_item.quantity,
            'Vente facture ' || coalesce(v_doc.document_number, ''), p_document_id, auth.uid());
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Conversion : Facture proforma -> Commande -> Facture
-- ---------------------------------------------------------------------------
create or replace function public.convert_document(p_source_id uuid, p_target text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(auth_role()::text, '');
  v_src documents%rowtype;
  v_existing uuid;
  v_number text;
  v_new uuid;
  v_user record;
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
      raise exception 'Seule une facture proforma peut être convertie en commande.';
    end if;
    if v_src.commercial_id <> auth.uid()
       and v_role not in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes') then
      raise exception 'Vous ne pouvez convertir que vos propres factures proforma.';
    end if;
  elsif p_target = 'facture' then
    if v_src.document_type::text <> 'commande' then
      raise exception 'Seule une commande peut être convertie en facture.';
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

  -- Déjà converti : on renvoie le document existant (double clic, deux onglets).
  select id into v_existing from documents
   where parent_document_id = v_src.id and document_type::text = p_target
   order by created_at limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  if not exists (select 1 from document_items where document_id = v_src.id) then
    raise exception 'Ce document ne contient aucun article.';
  end if;

  v_number := get_next_document_number(v_src.organization_id, p_target::document_type, extract(year from current_date)::int);

  perform set_config('app.doc_guard_bypass', 'on', true);

  insert into documents (organization_id, document_type, document_number, status, client_id, commercial_id,
                         parent_document_id, issue_date, due_date, subtotal, discount_amount, tax_amount, total_amount, notes)
  values (v_src.organization_id, p_target::document_type, v_number, 'brouillon', v_src.client_id, v_src.commercial_id,
          v_src.id, current_date, (current_date + interval '1 month')::date, v_src.subtotal, v_src.discount_amount,
          v_src.tax_amount, v_src.total_amount, v_src.notes)
  returning id into v_new;

  insert into document_items (document_id, product_id, designation, quantity, unit_price, tax_rate, discount_percent, position)
  select v_new, product_id, designation, quantity, unit_price, tax_rate, discount_percent, position
    from document_items where document_id = v_src.id order by position;

  update documents set status = 'accepte', updated_at = now()
   where id = v_src.id and status::text not in ('paye', 'paye_partiel');

  perform set_config('app.doc_guard_bypass', 'off', true);

  if p_target = 'facture' then
    perform apply_facture_stock(v_new);
  else
    -- Nouvelle commande : l'administration des ventes est prévenue pour la facturer.
    for v_user in
      select id from profiles where organization_id = v_src.organization_id and role::text = 'admin_ventes' and is_active
    loop
      insert into notifications (organization_id, user_id, type, title, message, related_document_id)
      values (v_src.organization_id, v_user.id, 'commande_a_facturer', 'Commande à facturer',
              format('La commande %s attend sa facture.', v_number), v_new);
    end loop;
  end if;

  return v_new;
end;
$$;
revoke all on function public.convert_document(uuid, text) from public, anon;
grant execute on function public.convert_document(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Ventes de l'équipe : visibles par les commerciaux sans les coordonnées clients
-- ---------------------------------------------------------------------------
create or replace function public.get_team_sales(p_from date default null, p_to date default null)
returns table (
  document_id uuid, document_type text, document_number text, issue_date date, status text,
  total_amount numeric, amount_paid numeric, commercial_id uuid, commercial_name text, client_name text, vehicles text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth_role()::text, '') not in
     ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes', 'commercial', 'chef_service') then
    raise exception 'Accès refusé.';
  end if;
  if not mfa_satisfied() then
    raise exception 'Double authentification requise.';
  end if;

  return query
  select d.id, d.document_type::text, d.document_number, d.issue_date, d.status::text,
         d.total_amount, d.amount_paid, d.commercial_id, p.full_name,
         coalesce(nullif(c.company_name, ''), nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), 'Client'),
         (select string_agg(distinct coalesce(pr.designation, split_part(di.designation, E'\n', 1)), ', ')
            from document_items di left join products pr on pr.id = di.product_id
           where di.document_id = d.id)
    from documents d
    left join profiles p on p.id = d.commercial_id
    left join clients c on c.id = d.client_id
   where d.organization_id = auth_org_id()
     and (d.document_type::text = 'facture' and d.status::text <> 'annule'
          or d.document_type::text = 'commande' and d.status::text not in ('accepte', 'annule'))
     and (p_from is null or d.issue_date >= p_from)
     and (p_to is null or d.issue_date <= p_to)
   order by d.issue_date desc, d.created_at desc
   limit 1000;
end;
$$;
revoke all on function public.get_team_sales(date, date) from public, anon;
grant execute on function public.get_team_sales(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Demandes d'inscription (chefs de service -> direction)
-- ---------------------------------------------------------------------------
create table if not exists user_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  requested_by uuid not null references profiles(id),
  full_name text not null,
  email text not null,
  phone text,
  role user_role not null,
  department text not null,
  note text,
  status text not null default 'en_attente' check (status in ('en_attente', 'validee', 'refusee')),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  decision_note text,
  created_user_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists user_requests_org_status_idx on user_requests (organization_id, status, created_at desc);
alter table user_requests enable row level security;

-- Département que l'utilisateur courant dirige (null = aucun).
create or replace function public.my_managed_department()
returns text language sql stable security definer set search_path = public as $$
  select case p.role::text
           when 'chef_atelier' then 'atelier'
           when 'responsable_showroom' then 'showroom'
           when 'chef_service' then p.department
           else null
         end
    from profiles p where p.id = auth.uid() and p.is_active;
$$;

-- Rôles qu'un département peut demander.
create or replace function public.department_allows_role(p_department text, p_role text)
returns boolean language sql immutable as $$
  select case p_department
           when 'commercial'     then p_role in ('commercial')
           when 'atelier'        then p_role in ('technicien', 'magasinier', 'receptionniste_sav')
           when 'pieces'         then p_role in ('magasinier')
           when 'showroom'       then p_role in ('vendeur_showroom')
           when 'marketing'      then p_role in ('marketing')
           when 'administration' then p_role in ('comptable', 'admin_ventes')
           else false
         end;
$$;

do $$ begin
  create policy user_requests_select on user_requests for select using (
  organization_id = auth_org_id()
  and (requested_by = auth.uid() or auth_role()::text in ('super_admin', 'administrateur', 'manager')));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy user_requests_insert on user_requests for insert with check (
  organization_id = auth_org_id()
  and requested_by = auth.uid()
  and status = 'en_attente' and decided_by is null and created_user_id is null
  and (
    (auth_role()::text in ('super_admin', 'administrateur', 'manager') and department_allows_role(department, role::text))
    or (department = my_managed_department() and department_allows_role(department, role::text))
  ));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy user_requests_update on user_requests for update using (
  organization_id = auth_org_id() and auth_role()::text in ('super_admin', 'administrateur', 'manager'));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy mfa_required on user_requests as restrictive for all to authenticated using ((select mfa_satisfied()));
exception when duplicate_object then null; end $$;

-- La direction est prévenue de chaque nouvelle demande.
create or replace function public.notify_user_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user record;
  v_by text;
begin
  select full_name into v_by from profiles where id = new.requested_by;
  for v_user in
    select id from profiles
     where organization_id = new.organization_id and is_active
       and role::text in ('super_admin', 'administrateur', 'manager') and id <> new.requested_by
  loop
    insert into notifications (organization_id, user_id, type, title, message)
    values (new.organization_id, v_user.id, 'demande_inscription', 'Demande d''inscription',
            format('%s demande un compte pour %s.', coalesce(v_by, 'Un chef de service'), new.full_name));
  end loop;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_notify_user_request') then
    create trigger trg_notify_user_request after insert on user_requests
  for each row execute function notify_user_request();
  end if;
end $$;

-- Fonctions internes : pas d'appel direct depuis l'API.
revoke all on function public.clients_status_guard() from public, anon, authenticated;
revoke all on function public.promote_client_on_payment() from public, anon, authenticated;
revoke all on function public.notify_user_request() from public, anon, authenticated;
revoke all on function public.my_managed_department() from public, anon;
grant execute on function public.my_managed_department() to authenticated;

-- Ajustement : la facturation des ordres de réparation (atelier/SAV) reste
-- possible pour l'atelier et la caisse ; les ventes de véhicules passent par
-- la commande et l'administration des ventes.
alter policy documents_insert on documents with check (
  organization_id = auth_org_id()
  and (commercial_id = auth.uid()
       or auth_role()::text = any (array['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes']))
  and (document_type::text <> 'facture'
       or auth_role()::text = any (array['super_admin', 'administrateur', 'manager', 'admin_ventes', 'comptable', 'receptionniste_sav', 'chef_atelier'])));
