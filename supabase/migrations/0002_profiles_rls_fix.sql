-- Correctif : RLS manquant sur profiles + fonctions utilitaires en SECURITY DEFINER
-- (necessaire pour eviter la recursion quand une policy d'une autre table
-- interroge profiles via auth_role()/auth_org_id())

create or replace function auth_role() returns user_role
language sql security definer stable
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function auth_org_id() returns uuid
language sql security definer stable
set search_path = public
as $$
  select organization_id from profiles where id = auth.uid();
$$;

alter table profiles enable row level security;

create policy profiles_select_self on profiles for select using (
  id = auth.uid()
);

create policy profiles_select_admin on profiles for select using (
  organization_id = auth_org_id() and auth_role() in ('super_admin','administrateur')
);

create policy profiles_update_self on profiles for update using (
  id = auth.uid()
);
