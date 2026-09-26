-- Relances automatiques des factures/devis impayés en retard.
-- On ne crée pas de tâche planifiée côté Postgres (pg_cron n'est pas
-- garanti disponible sur tous les plans Supabase) : la vérification est
-- déclenchée depuis l'app elle-même, via la synchronisation périodique déjà
-- en place côté client (toutes les 2 minutes + à chaque retour en ligne).
-- Cette colonne évite simplement d'envoyer plusieurs relances le même jour.
alter table documents add column if not exists last_reminder_at timestamptz;

-- security definer : nécessaire pour pouvoir insérer dans "notifications"
-- (aucune policy d'insertion n'existe pour les utilisateurs normaux — seuls
-- les triggers système le font, même logique que notify_payment_received).
-- Le filtre "organization_id = auth_org_id()" restreint quand même chaque
-- appel aux documents de l'organisation de l'appelant.
create or replace function generate_overdue_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_doc record;
  v_count integer := 0;
begin
  for v_doc in
    select id, document_number, balance_due, commercial_id, organization_id
    from documents
    where organization_id = auth_org_id()
      and balance_due > 0
      and status in ('envoye', 'paye_partiel')
      and due_date < current_date
      and commercial_id is not null
      and (last_reminder_at is null or last_reminder_at < now() - interval '24 hours')
  loop
    insert into notifications (organization_id, user_id, type, title, message, related_document_id)
    values (
      v_doc.organization_id,
      v_doc.commercial_id,
      'relance_impaye',
      'Facture en retard',
      format('%s : %s FCFA restant, échéance dépassée', coalesce(v_doc.document_number, 'Un document'), to_char(round(v_doc.balance_due), 'FM999G999G999')),
      v_doc.id
    );
    update documents set last_reminder_at = now() where id = v_doc.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
