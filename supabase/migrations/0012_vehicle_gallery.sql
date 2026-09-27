-- Galerie de véhicules : plusieurs photos par produit/véhicule, stockées
-- dans un bucket dédié (public, pour qu'un lien puisse être envoyé au
-- client par WhatsApp sans qu'il ait besoin d'un compte).

create table product_photos (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  product_id        uuid not null references products(id) on delete cascade,
  storage_path      text not null,
  url               text not null,
  position          int default 0,
  uploaded_by        uuid references profiles(id),
  created_at        timestamptz default now()
);

create index idx_product_photos_product on product_photos(product_id, position);

alter table product_photos enable row level security;

-- Lecture ouverte à toute l'organisation, comme le catalogue produits.
create policy product_photos_select on product_photos for select using (
  organization_id = auth_org_id()
);

-- Ajout de photos : ouvert à tous les rôles de l'organisation (un commercial
-- doit pouvoir photographier un véhicule sans passer par un admin), pas
-- seulement super_admin/administrateur comme pour products_write.
create policy product_photos_insert on product_photos for insert with check (
  organization_id = auth_org_id()
  and exists (select 1 from products p where p.id = product_photos.product_id and p.organization_id = auth_org_id())
);

-- Suppression : l'auteur de l'ajout, ou un rôle habilité à gérer le catalogue.
create policy product_photos_delete on product_photos for delete using (
  organization_id = auth_org_id()
  and (auth_role() in ('super_admin','administrateur','manager') or uploaded_by = auth.uid())
);

insert into storage.buckets (id, name, public)
values ('vehicle-photos', 'vehicle-photos', true)
on conflict (id) do update set public = true;

drop policy if exists vehicle_photos_public_read on storage.objects;
create policy vehicle_photos_public_read on storage.objects for select
  using (bucket_id = 'vehicle-photos');

drop policy if exists vehicle_photos_org_write on storage.objects;
create policy vehicle_photos_org_write on storage.objects for insert
  with check (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth_org_id()::text
  );

drop policy if exists vehicle_photos_org_delete on storage.objects;
create policy vehicle_photos_org_delete on storage.objects for delete
  using (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth_org_id()::text
  );
