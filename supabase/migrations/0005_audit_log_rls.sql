-- La table audit_log (0001_init.sql) n'avait jamais eu la RLS activée :
-- sans ça, elle reste accessible via l'API Supabase à quiconque a une
-- session valide (pas de cloisonnement par organisation ni par rôle) —
-- faille de sécurité corrigée ici, avant l'ajout de la page /audit.

-- IMPORTANT : audit_trigger_fn() (0001_init.sql) n'était PAS "security
-- definer" — sans ce correctif, activer la RLS juste en dessous aurait
-- bloqué (silencieusement en apparence, en réalité en erreur) TOUTE
-- création/modification/suppression de document, client ou paiement, car
-- le trigger aurait tenté d'insérer dans audit_log avec les droits de
-- l'utilisateur courant, sans policy d'insertion. On la rend security
-- definer, comme les autres triggers du projet (notify_payment_received,
-- notify_low_stock, generate_overdue_reminders).
create or replace function audit_trigger_fn() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log(organization_id, user_id, table_name, record_id, action, old_data, new_data)
  values (
    coalesce(new.organization_id, old.organization_id),
    auth.uid(),
    tg_table_name,
    coalesce(new.id, old.id),
    lower(tg_op)::audit_action,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

alter table audit_log enable row level security;

create policy audit_log_select_admin on audit_log for select using (
  organization_id = auth_org_id()
  and auth_role() in ('super_admin', 'administrateur')
);

-- Aucune policy insert/update/delete : seuls les triggers (security definer
-- implicite car exécutés par le rôle propriétaire de la table) y écrivent ;
-- personne ne doit pouvoir modifier ou effacer l'historique depuis l'API.
