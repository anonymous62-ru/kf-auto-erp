-- Correctif : deux failles RLS empêchaient certaines écritures pourtant
-- légitimes (retour de test en production, 26/27 sept 2026).
--
-- 1. stock_movements n'avait AUCUNE policy d'écriture (seulement stock_select
--    en lecture) : la RLS bloque par défaut tout accès sans policy explicite,
--    donc "+ Ajouter au stock" / "- Retirer du stock" échouaient pour
--    absolument tout le monde, y compris super_admin.
--
-- 2. payments_write n'autorisait que super_admin/administrateur/comptable :
--    un commercial ne pouvait jamais enregistrer un paiement, même sur l'une
--    de ses propres factures.

create policy stock_write on stock_movements for insert with check (
  organization_id = auth_org_id() and (
    auth_role() in ('super_admin','administrateur','manager')
    or exists (
      select 1 from products p
      where p.id = stock_movements.product_id
        and p.organization_id = auth_org_id()
    )
  )
);

drop policy if exists payments_write on payments;

create policy payments_write on payments for insert with check (
  organization_id = auth_org_id() and (
    auth_role() in ('super_admin','administrateur','comptable','manager')
    or exists (
      select 1 from documents d
      where d.id = payments.document_id
        and d.organization_id = auth_org_id()
        and d.commercial_id = auth.uid()
    )
  )
);
