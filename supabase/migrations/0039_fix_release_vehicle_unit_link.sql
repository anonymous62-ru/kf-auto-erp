-- 0039 : correctif. Quand le dernier lien d'un châssis vers un document
-- disparaissait, la fonction lisait une variable jamais remplie et
-- plantait ("record v_doc is not assigned yet"). Elle libère maintenant le
-- véhicule sauf s'il reste attaché à une facture déjà payée.
create or replace function public.release_vehicle_unit_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_unit uuid := case when tg_op = 'DELETE' then old.vehicle_unit_id else new.vehicle_unit_id end;
  v_active uuid;
  v_type text;
  v_paid numeric;
  v_release boolean := true;
begin
  if tg_op = 'UPDATE' and (new.removed_at is null or old.removed_at is not null) then
    return new;
  end if;
  v_active := vehicle_unit_active_document(v_unit);
  if v_active is not null then
    select document_type::text, amount_paid into v_type, v_paid from documents where id = v_active;
    if v_type = 'facture' and coalesce(v_paid, 0) > 0 then
      v_release := false;
    end if;
  end if;
  if v_release then
    update vehicle_units
       set status = 'disponible', sold_document_id = null, sold_at = null
     where id = v_unit and status in ('reserve', 'vendu');
  end if;
  return null;
end;
$$;
