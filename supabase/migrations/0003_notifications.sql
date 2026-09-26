-- Centre de notifications : RLS + génération automatique
-- (paiement reçu, stock bas) via triggers PostgreSQL.

-- Nécessaire pour que le badge se mette à jour en temps réel (Supabase
-- Realtime n'écoute que les tables explicitement ajoutées à cette publication).
alter publication supabase_realtime add table notifications;

alter table notifications enable row level security;

create policy notifications_select_self on notifications for select using (
  user_id = auth.uid()
);

create policy notifications_update_self on notifications for update using (
  user_id = auth.uid()
);

-- ---------- Paiement reçu : notifie le commercial du document ----------
create or replace function notify_payment_received() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_document documents%rowtype;
begin
  select * into v_document from documents where id = new.document_id;
  if v_document.commercial_id is not null then
    insert into notifications (organization_id, user_id, type, title, message, related_document_id)
    values (
      v_document.organization_id,
      v_document.commercial_id,
      'paiement_recu',
      'Paiement reçu',
      format('Paiement de %s FCFA reçu sur %s', to_char(new.amount, 'FM999G999G999'), coalesce(v_document.document_number, 'un document')),
      v_document.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_payment on payments;
create trigger trg_notify_payment after insert on payments
for each row execute function notify_payment_received();

-- ---------- Stock bas : notifie les responsables (super_admin/administrateur/manager) ----------
create or replace function notify_low_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_manager profiles%rowtype;
begin
  if new.quantity_on_hand <= new.stock_min and (old.quantity_on_hand > old.stock_min or old.quantity_on_hand is null) then
    for v_manager in
      select * from profiles
      where organization_id = new.organization_id
        and role in ('super_admin', 'administrateur', 'manager')
        and is_active = true
    loop
      insert into notifications (organization_id, user_id, type, title, message)
      values (
        new.organization_id,
        v_manager.id,
        'rupture_stock',
        'Stock bas',
        format('%s : il ne reste que %s en stock (seuil : %s)', new.designation, new.quantity_on_hand, new.stock_min)
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_low_stock on products;
create trigger trg_notify_low_stock after update on products
for each row execute function notify_low_stock();
