-- =============================================================================
-- 0054 : Droits modifiables par le super admin (demande du 17/11/2026)
--
-- Socle : une matrice rôle x droit par organisation. Les valeurs par défaut
-- reproduisent exactement le comportement actuel ; le super admin peut
-- ensuite cocher ou décocher un droit pour un rôle. Le super admin a
-- toujours tous les droits (impossible de se bloquer soi-même).
--
-- Droits (clés stables) :
--   valider_proforma, verifier_commande, preparer_facture, valider_facture,
--   emettre_facture, ventes_globales, modifier_stock, gerer_utilisateurs,
--   gerer_objectifs, confirmer_paiement
-- =============================================================================
create table if not exists public.role_permissions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role text not null,
  permission text not null,
  allowed boolean not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (organization_id, role, permission)
);
alter table public.role_permissions enable row level security;
create policy role_permissions_select on public.role_permissions for select to authenticated
  using (organization_id = auth_org_id());
create policy mfa_required on public.role_permissions as restrictive for all to authenticated
  using ((select mfa_satisfied()));
-- Écriture uniquement par la fonction set_role_permission (super admin).

create or replace function public.default_permission(p_role text, p_permission text)
returns boolean language sql immutable set search_path = public as $$
  select case p_permission
    when 'valider_proforma'   then p_role in ('super_admin','administrateur','manager','responsable_commercial','admin_ventes','comptable')
    when 'verifier_commande'  then p_role in ('super_admin','administrateur','manager','responsable_commercial','admin_ventes','comptable')
    when 'preparer_facture'   then p_role in ('super_admin','administrateur','manager','responsable_commercial','admin_ventes','comptable')
    when 'valider_facture'    then p_role in ('super_admin','administrateur','manager','responsable_commercial','admin_ventes','comptable')
    when 'emettre_facture'    then p_role in ('super_admin','administrateur','manager','responsable_commercial','admin_ventes','comptable')
    when 'ventes_globales'    then p_role not in ('commercial','vendeur_showroom','responsable_showroom')
    when 'modifier_stock'     then p_role in ('super_admin','administrateur','manager','responsable_showroom','admin_ventes')
    when 'gerer_utilisateurs' then p_role in ('super_admin','administrateur')
    when 'gerer_objectifs'    then p_role in ('super_admin','administrateur','manager','responsable_commercial')
    when 'confirmer_paiement' then p_role in ('super_admin','administrateur','manager','comptable')
    else false
  end;
$$;

-- Droit de l'utilisateur connecté.
create or replace function public.has_permission(p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when coalesce(auth_role()::text, '') = 'super_admin' then true
    when auth_role() is null then false
    else coalesce(
      (select rp.allowed from role_permissions rp
        where rp.organization_id = auth_org_id() and rp.role = auth_role()::text and rp.permission = p_permission),
      default_permission(auth_role()::text, p_permission))
  end;
$$;
revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

-- Matrice complète (pour l'écran du super admin et pour l'application).
create or replace function public.permission_matrix()
returns table (role text, permission text, allowed boolean, is_default boolean)
language sql stable security definer set search_path = public as $$
  with roles as (select unnest(enum_range(null::user_role))::text as role),
       perms as (select unnest(array['valider_proforma','verifier_commande','preparer_facture','valider_facture',
                                     'emettre_facture','ventes_globales','modifier_stock','gerer_utilisateurs',
                                     'gerer_objectifs','confirmer_paiement']) as permission)
  select r.role, p.permission,
         case when r.role = 'super_admin' then true
              else coalesce(rp.allowed, default_permission(r.role, p.permission)) end,
         rp.allowed is null
    from roles r cross join perms p
    left join role_permissions rp
      on rp.organization_id = auth_org_id() and rp.role = r.role and rp.permission = p.permission
   where auth_org_id() is not null;
$$;
revoke all on function public.permission_matrix() from public, anon;
grant execute on function public.permission_matrix() to authenticated;

create or replace function public.set_role_permission(p_role text, p_permission text, p_allowed boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Session expirée, reconnectez-vous.'; end if;
  if not mfa_satisfied() then raise exception 'Double authentification requise.'; end if;
  if coalesce(auth_role()::text, '') <> 'super_admin' then
    raise exception 'Seul le super administrateur modifie les droits.';
  end if;
  if p_role = 'super_admin' then raise exception 'Le super administrateur garde toujours tous les droits.'; end if;
  if p_role not in (select unnest(enum_range(null::user_role))::text) then raise exception 'Rôle inconnu.'; end if;
  if p_permission not in ('valider_proforma','verifier_commande','preparer_facture','valider_facture','emettre_facture',
                          'ventes_globales','modifier_stock','gerer_utilisateurs','gerer_objectifs','confirmer_paiement') then
    raise exception 'Droit inconnu.';
  end if;
  insert into role_permissions (organization_id, role, permission, allowed, updated_by, updated_at)
  values (auth_org_id(), p_role, p_permission, p_allowed, auth.uid(), now())
  on conflict (organization_id, role, permission)
  do update set allowed = excluded.allowed, updated_by = excluded.updated_by, updated_at = now();
  insert into audit_log (organization_id, user_id, table_name, record_id, action, new_data)
  values (auth_org_id(), auth.uid(), 'role_permissions', null, 'update',
          jsonb_build_object('role', p_role, 'droit', p_permission, 'autorise', p_allowed));
end;
$$;
revoke all on function public.set_role_permission(text, text, boolean) from public, anon;
grant execute on function public.set_role_permission(text, text, boolean) to authenticated;
