-- =============================================================================
-- 0042 : Durcissement (audit de sécurité du 17/10/2026)
--   - les fonctions de déclencheur ne doivent pas être appelables par l'API
--     (/rest/v1/rpc/...). Un déclencheur s'exécute sans vérifier ce droit,
--     le retirer ne change rien au fonctionnement ;
--   - search_path figé sur department_allows_role.
-- =============================================================================
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
  end loop;
end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'department_allows_role'
  loop
    execute format('alter function %s set search_path = public', r.fn);
  end loop;
end;
$$;
