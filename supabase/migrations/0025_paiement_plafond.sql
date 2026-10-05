-- Refuse un paiement qui dépasse le solde restant de la facture (test du
-- 04/10 au soir : 1 500 000 FCFA encaissés sur une facture de 1 000 000
-- passaient sans erreur). Appliqué directement sur la base le 04/10.
create or replace function check_payment_not_over_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_paid numeric;
begin
  select total_amount into v_total from documents where id = new.document_id;
  select coalesce(sum(amount), 0) into v_paid from payments where document_id = new.document_id;
  if v_total is not null and v_paid + new.amount > v_total + 0.5 then
    raise exception 'Paiement refusé : il dépasse le solde restant (% FCFA).', to_char(greatest(v_total - v_paid, 0), 'FM999G999G999G990');
  end if;
  return new;
end;
$$;

revoke execute on function check_payment_not_over_balance() from public, anon;

create trigger trg_check_payment_balance
  before insert on payments
  for each row execute function check_payment_not_over_balance();

-- Les fonctions serveur de confiance (modification d'un document, etc.)
-- positionnent app.doc_guard_bypass = 'on' pour la durée de leur
-- transaction ; ce réglage n'est pas modifiable via l'API REST.
create or replace function protect_document_financials()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
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
