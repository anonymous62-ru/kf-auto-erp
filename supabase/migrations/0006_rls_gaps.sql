-- Complète la RLS laissée volontairement incomplète en 0001_init.sql (voir
-- son commentaire final : "des policies équivalentes doivent être répliquées
-- sur... notifications, document_items, document_sendings, client_attachments").
-- Sans ça, ces tables restent lisibles/modifiables par n'importe quel
-- utilisateur authentifié via l'API Supabase, sans cloisonnement par
-- organisation — même faille que celle corrigée sur audit_log
-- (0005_audit_log_rls.sql). notifications avait déjà été traitée à part.

-- IMPORTANT : même piège que pour audit_trigger_fn (0005) — cette fonction
-- est appelée directement par le client (via supabase.rpc(), avec la
-- session de l'utilisateur connecté) et fait un INSERT ... ON CONFLICT DO
-- UPDATE sur document_number_counters. Sans "security definer", verrouiller
-- cette table juste en dessous (lecture seule pour les utilisateurs)
-- aurait cassé l'attribution de numéro sur TOUS les documents, online
-- comme lors de la synchronisation offline.
create or replace function get_next_document_number(
  p_organization_id uuid,
  p_document_type   document_type,
  p_year            int
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_prefix text;
  v_next   int;
begin
  -- security definer contourne la RLS : on vérifie donc nous-mêmes que
  -- l'appelant agit bien pour SA propre organisation, pour ne pas laisser
  -- n'importe quel utilisateur authentifié consommer/décaler la
  -- numérotation d'une autre organisation.
  if p_organization_id != auth_org_id() then
    raise exception 'Organisation non autorisée';
  end if;

  v_prefix := case p_document_type
    when 'proforma'      then 'PF'
    when 'devis'          then 'DEV'
    when 'facture'        then 'FAC'
    when 'bon_livraison'  then 'BL'
    when 'recu'           then 'REC'
    when 'avoir'          then 'AV'
  end;

  insert into document_number_counters (organization_id, document_type, year, last_number)
  values (p_organization_id, p_document_type, p_year, 1)
  on conflict (organization_id, document_type, year)
  do update set last_number = document_number_counters.last_number + 1
  returning last_number into v_next;

  return v_prefix || '-' || p_year || '-' || lpad(v_next::text, 6, '0');
end;
$$;

alter table organizations enable row level security;
alter table client_attachments enable row level security;
alter table product_categories enable row level security;
alter table document_number_counters enable row level security;
alter table document_items enable row level security;
alter table document_sendings enable row level security;

-- ORGANIZATIONS : un utilisateur ne voit/modifie que sa propre organisation
create policy organizations_select on organizations for select using (
  id = auth_org_id()
);

create policy organizations_update on organizations for update using (
  id = auth_org_id() and auth_role() in ('super_admin', 'administrateur')
);

-- CLIENT_ATTACHMENTS : hérite du cloisonnement de la fiche client parente
create policy client_attachments_select on client_attachments for select using (
  exists (
    select 1 from clients c
    where c.id = client_attachments.client_id
      and c.organization_id = auth_org_id()
      and (auth_role() in ('super_admin','administrateur','manager','comptable') or c.assigned_to = auth.uid())
  )
);

create policy client_attachments_write on client_attachments for insert with check (
  exists (select 1 from clients c where c.id = client_attachments.client_id and c.organization_id = auth_org_id())
);

create policy client_attachments_delete on client_attachments for delete using (
  exists (
    select 1 from clients c
    where c.id = client_attachments.client_id
      and c.organization_id = auth_org_id()
      and (auth_role() in ('super_admin','administrateur') or c.assigned_to = auth.uid())
  )
);

-- PRODUCT_CATEGORIES : même logique que products (lecture ouverte à l'org, écriture réservée)
create policy product_categories_select on product_categories for select using (
  organization_id = auth_org_id()
);

create policy product_categories_write on product_categories for all using (
  organization_id = auth_org_id() and auth_role() in ('super_admin','administrateur')
);

-- DOCUMENT_NUMBER_COUNTERS : lecture seule pour l'org (aucune écriture directe
-- via l'API — uniquement via la fonction de numérotation, qui s'exécute en
-- security definer et contourne donc cette RLS)
create policy document_number_counters_select on document_number_counters for select using (
  organization_id = auth_org_id()
);

-- DOCUMENT_ITEMS : hérite du cloisonnement du document parent (même logique que documents_*)
create policy document_items_select on document_items for select using (
  exists (
    select 1 from documents d
    where d.id = document_items.document_id
      and d.organization_id = auth_org_id()
      and (auth_role() in ('super_admin','administrateur','manager','comptable') or d.commercial_id = auth.uid())
  )
);

create policy document_items_write on document_items for all using (
  exists (
    select 1 from documents d
    where d.id = document_items.document_id
      and d.organization_id = auth_org_id()
      and (auth_role() in ('super_admin','administrateur') or d.commercial_id = auth.uid())
  )
);

-- DOCUMENT_SENDINGS : même logique, hérite du document parent
create policy document_sendings_select on document_sendings for select using (
  exists (
    select 1 from documents d
    where d.id = document_sendings.document_id
      and d.organization_id = auth_org_id()
      and (auth_role() in ('super_admin','administrateur','manager','comptable') or d.commercial_id = auth.uid())
  )
);

create policy document_sendings_insert on document_sendings for insert with check (
  exists (
    select 1 from documents d
    where d.id = document_sendings.document_id
      and d.organization_id = auth_org_id()
      and (auth_role() in ('super_admin','administrateur') or d.commercial_id = auth.uid())
  )
);
