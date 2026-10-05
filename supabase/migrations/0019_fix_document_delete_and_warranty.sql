-- Deux correctifs signalés par le DG (04/10), avant le passage en usage réel
-- lundi :
--
-- 1) "les factures ne se suppriment pas actuellement"
--    La policy documents_delete (migration 0011) n'autorisait la suppression
--    qu'aux rôles super_admin/administrateur, ou au commercial propriétaire
--    (commercial_id = auth.uid()). Toutes les autres policies de l'app
--    (clients, prospects, contrats...) incluent systématiquement 'manager' et
--    'comptable' au même niveau que super_admin/administrateur. Un
--    manager (ou un comptable) qui essaie de supprimer une facture de test
--    ne déclenche AUCUNE erreur côté Supabase : la ligne ne correspond
--    simplement pas au USING de la policy RLS, donc 0 ligne est supprimée en
--    silence - ce qui correspond exactement au symptôme décrit ("les
--    factures ne partent pas"). On aligne documents_delete et
--    document_sendings_delete sur le même périmètre que le reste de l'app.
--
-- 2) vehicle_warranties.duration_months avait un défaut de 36 (migration
--    0016), alors que la garantie réelle Chery/KF Auto est de 5 ans
--    (60 mois) / 100 000 km.

drop policy if exists documents_delete on documents;
create policy documents_delete on documents for delete using (
  organization_id = auth_org_id() and (
    auth_role()::text in ('super_admin', 'administrateur', 'manager', 'comptable')
    or commercial_id = auth.uid()
  )
);

drop policy if exists document_sendings_delete on document_sendings;
create policy document_sendings_delete on document_sendings for delete using (
  exists (
    select 1 from documents d
    where d.id = document_sendings.document_id
      and d.organization_id = auth_org_id()
      and (
        auth_role()::text in ('super_admin', 'administrateur', 'manager', 'comptable')
        or d.commercial_id = auth.uid()
      )
  )
);

alter table vehicle_warranties alter column duration_months set default 60;

-- Pas de ligne existante à corriger : ce module (migration 0016) vient
-- d'être livré, aucune garantie n'a encore été créée en conditions réelles.
