-- =============================================================================
-- 0038 : Catalogues produits (direction, 10/10/2026)
--
-- 1. Photos des véhicules dans le bucket public "vehicules" (plusieurs par
--    modèle : extérieur, intérieur, détails), avec ordre et photo principale.
-- 2. Textes commerciaux du catalogue par modèle (accroche, points forts,
--    équipements, couleurs) ; la fiche technique reste la description produit.
-- 3. Envois de catalogues : qui, à qui, quels modèles, quand, par quel canal,
--    avec un lien public qui expire (30 jours) et le suivi des ouvertures.
-- Droits : commerciaux, showroom et marketing génèrent et envoient ; seules
-- l'administration et la chargée marketing modifient photos et textes.
-- =============================================================================

create or replace function public.is_catalogue_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth_role()::text, '') in ('super_admin', 'administrateur', 'manager', 'marketing');
$$;
revoke all on function public.is_catalogue_editor() from public, anon;
grant execute on function public.is_catalogue_editor() to authenticated;

create or replace function public.is_catalogue_sender()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth_role()::text, '') in
    ('super_admin', 'administrateur', 'manager', 'admin_ventes', 'marketing', 'commercial',
     'responsable_showroom', 'vendeur_showroom', 'chef_service');
$$;
revoke all on function public.is_catalogue_sender() from public, anon;
grant execute on function public.is_catalogue_sender() to authenticated;

-- ---------------------------------------------------------------------------
-- Bucket "vehicules"
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicules', 'vehicules', true, 6291456, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy vehicules_public_read on storage.objects
  for select using (bucket_id = 'vehicules');

create policy vehicules_editor_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'vehicules'
              and (storage.foldername(name))[1] = auth_org_id()::text
              and is_catalogue_editor());

create policy vehicules_editor_update on storage.objects
  for update to authenticated
  using (bucket_id = 'vehicules'
         and (storage.foldername(name))[1] = auth_org_id()::text
         and is_catalogue_editor());

create policy vehicules_editor_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'vehicules'
         and (storage.foldername(name))[1] = auth_org_id()::text
         and is_catalogue_editor());

-- ---------------------------------------------------------------------------
-- Photos : type, photo principale, droits
-- ---------------------------------------------------------------------------
alter table public.product_photos add column if not exists kind text not null default 'exterieur';
alter table public.product_photos add column if not exists is_main boolean not null default false;
alter table public.product_photos add column if not exists bucket text not null default 'vehicle-photos';
alter table public.product_photos add column if not exists source_url text;

alter table public.product_photos add constraint product_photos_kind_check
  check (kind in ('exterieur', 'interieur', 'detail'));

create unique index if not exists idx_product_photos_one_main on public.product_photos (product_id) where is_main;

-- La première photo existante de chaque modèle devient la principale.
update public.product_photos p set is_main = true
 where p.id = (select q.id from product_photos q where q.product_id = p.product_id order by q.position, q.created_at limit 1)
   and not exists (select 1 from product_photos m where m.product_id = p.product_id and m.is_main);

alter policy product_photos_insert on public.product_photos
  with check (
    organization_id = auth_org_id()
    and is_catalogue_editor()
    and exists (select 1 from products p where p.id = product_photos.product_id and p.organization_id = auth_org_id())
  );

alter policy product_photos_delete on public.product_photos
  using (organization_id = auth_org_id() and is_catalogue_editor());

create policy product_photos_update on public.product_photos
  for update to authenticated
  using (organization_id = auth_org_id() and is_catalogue_editor())
  with check (organization_id = auth_org_id() and is_catalogue_editor());

-- Ordre et photo principale en une seule opération.
create or replace function public.set_product_photo_order(p_product_id uuid, p_photo_ids uuid[], p_main_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_url text;
begin
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;
  if not is_catalogue_editor() then
    raise exception 'Seules l''administration et la chargée marketing modifient les photos.';
  end if;
  select organization_id into v_org from products where id = p_product_id;
  if v_org is null or v_org <> auth_org_id() then raise exception 'Modèle introuvable.'; end if;
  if p_main_id is not null and not exists (select 1 from product_photos where id = p_main_id and product_id = p_product_id) then
    raise exception 'Photo introuvable.';
  end if;

  update product_photos ph
     set position = x.ord - 1
    from unnest(p_photo_ids) with ordinality as x(id, ord)
   where ph.id = x.id and ph.product_id = p_product_id;

  update product_photos set is_main = false where product_id = p_product_id and is_main and id is distinct from p_main_id;
  if p_main_id is not null then
    update product_photos set is_main = true where id = p_main_id;
    select url into v_url from product_photos where id = p_main_id;
  end if;
  update products set photo_url = v_url, updated_at = now() where id = p_product_id;
end;
$$;
revoke all on function public.set_product_photo_order(uuid, uuid[], uuid) from public, anon;
grant execute on function public.set_product_photo_order(uuid, uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Textes du catalogue
-- ---------------------------------------------------------------------------
create table if not exists public.product_catalogue (
  product_id uuid primary key references products(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  tagline text,
  highlights text,
  equipment text,
  colors text,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.product_catalogue enable row level security;

create policy product_catalogue_select on public.product_catalogue
  for select to authenticated using (organization_id = auth_org_id());

create policy product_catalogue_insert on public.product_catalogue
  for insert to authenticated
  with check (organization_id = auth_org_id() and is_catalogue_editor()
              and exists (select 1 from products p where p.id = product_catalogue.product_id and p.organization_id = auth_org_id()));

create policy product_catalogue_update on public.product_catalogue
  for update to authenticated
  using (organization_id = auth_org_id() and is_catalogue_editor())
  with check (organization_id = auth_org_id() and is_catalogue_editor());

create policy mfa_required on public.product_catalogue
  as restrictive for all to authenticated
  using ((select mfa_satisfied())) with check ((select mfa_satisfied()));

-- ---------------------------------------------------------------------------
-- Envois de catalogues
-- ---------------------------------------------------------------------------
create table if not exists public.catalogue_sendings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_by uuid not null references profiles(id),
  client_id uuid references clients(id) on delete set null,
  prospect_id uuid references prospects(id) on delete set null,
  recipient_name text,
  recipient_phone text,
  recipient_email text,
  channel text not null check (channel in ('whatsapp', 'email', 'lien')),
  kind text not null check (kind in ('fiche', 'gamme')),
  product_ids uuid[] not null check (cardinality(product_ids) between 1 and 20),
  show_prices boolean not null default false,
  prices_valid_until date,
  expires_at timestamptz not null default (now() + interval '30 days'),
  opened_count integer not null default 0,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  constraint catalogue_sendings_recipient check (
    client_id is not null or prospect_id is not null
    or coalesce(btrim(recipient_name), '') <> '' or coalesce(btrim(recipient_phone), '') <> ''
    or coalesce(btrim(recipient_email), '') <> ''),
  constraint catalogue_sendings_prices check (not show_prices or prices_valid_until is not null)
);
create index if not exists idx_catalogue_sendings_org on public.catalogue_sendings (organization_id, created_at desc);
create index if not exists idx_catalogue_sendings_client on public.catalogue_sendings (client_id) where client_id is not null;
create index if not exists idx_catalogue_sendings_prospect on public.catalogue_sendings (prospect_id) where prospect_id is not null;

alter table public.catalogue_sendings enable row level security;

create policy catalogue_sendings_select on public.catalogue_sendings
  for select to authenticated
  using (
    organization_id = auth_org_id()
    and (created_by = auth.uid()
         or auth_role()::text in ('super_admin', 'administrateur', 'manager', 'admin_ventes', 'marketing', 'chef_service')
         or (client_id is not null and exists (select 1 from clients c where c.id = catalogue_sendings.client_id))
         or (prospect_id is not null and exists (select 1 from prospects l where l.id = catalogue_sendings.prospect_id)))
  );

create policy catalogue_sendings_insert on public.catalogue_sendings
  for insert to authenticated
  with check (
    organization_id = auth_org_id()
    and created_by = auth.uid()
    and is_catalogue_sender()
    and opened_count = 0 and first_opened_at is null and last_opened_at is null
    and expires_at <= now() + interval '31 days'
    and (client_id is null or exists (select 1 from clients c where c.id = catalogue_sendings.client_id))
    and (prospect_id is null or exists (select 1 from prospects l where l.id = catalogue_sendings.prospect_id))
  );

create policy mfa_required on public.catalogue_sendings
  as restrictive for all to authenticated
  using ((select mfa_satisfied())) with check ((select mfa_satisfied()));

-- Pas d'update/delete pour les utilisateurs : l'historique est fixe. Le
-- compteur d'ouvertures est mis à jour par la page publique (clé serveur).

-- ---------------------------------------------------------------------------
-- Campagnes : catalogues envoyés aux leads de chaque campagne
-- ---------------------------------------------------------------------------
create or replace function public.campaign_catalogue_stats()
returns table (campaign_id uuid, sent bigint, opened bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth_role()::text, '') not in ('super_admin', 'administrateur', 'manager', 'marketing', 'admin_ventes', 'chef_service') then
    raise exception 'Accès refusé.';
  end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;
  return query
  select c.id,
         count(distinct s.id),
         count(distinct s.id) filter (where s.opened_count > 0)
    from campaigns c
    left join prospects l on l.campaign_id = c.id
    left join catalogue_sendings s
      on s.organization_id = c.organization_id
     and (s.prospect_id = l.id or (l.client_id is not null and s.client_id = l.client_id))
   where c.organization_id = auth_org_id()
   group by c.id;
end;
$$;
revoke all on function public.campaign_catalogue_stats() from public, anon;
grant execute on function public.campaign_catalogue_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- Rapports : envois de catalogues sur la période
-- ---------------------------------------------------------------------------
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.report_summary(date, date)'::regprocedure);
  v_def := replace(v_def,
    $a$'period', jsonb_build_object('from', p_from, 'to', p_to),$a$,
    $b$'period', jsonb_build_object('from', p_from, 'to', p_to),
    'catalogues', jsonb_build_object(
      'sent', (select count(*) from catalogue_sendings s where s.organization_id = v_org and s.created_at::date between p_from and p_to),
      'opened', (select count(*) from catalogue_sendings s where s.organization_id = v_org and s.created_at::date between p_from and p_to and s.opened_count > 0),
      'whatsapp', (select count(*) from catalogue_sendings s where s.organization_id = v_org and s.created_at::date between p_from and p_to and s.channel = 'whatsapp'),
      'email', (select count(*) from catalogue_sendings s where s.organization_id = v_org and s.created_at::date between p_from and p_to and s.channel = 'email'),
      'by_commercial', (select coalesce(jsonb_agg(x order by x.sent desc), '[]'::jsonb) from (
          select coalesce(p.full_name, '?') as name, count(*) as sent, count(*) filter (where s.opened_count > 0) as opened
            from catalogue_sendings s join profiles p on p.id = s.created_by
           where s.organization_id = v_org and s.created_at::date between p_from and p_to
           group by p.full_name) x),
      'by_model', (select coalesce(jsonb_agg(y order by y.sent desc), '[]'::jsonb) from (
          select pr.designation as name, count(*) as sent
            from catalogue_sendings s cross join lateral unnest(s.product_ids) as u(pid) join products pr on pr.id = u.pid
           where s.organization_id = v_org and s.created_at::date between p_from and p_to
           group by pr.designation) y)
    ),$b$);
  if position('''catalogues''' in v_def) = 0 then
    raise exception 'report_summary : motif introuvable, migration à revoir';
  end if;
  execute v_def;
end;
$$;
