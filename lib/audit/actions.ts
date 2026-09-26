'use server';

import { createClient } from '@/lib/supabase/server';

export type AuditEntry = {
  id: string;
  table_name: string;
  record_id: string | null;
  action: 'insert' | 'update' | 'delete' | 'login';
  created_at: string;
  user_id: string | null;
  profiles: { full_name: string | null } | { full_name: string | null }[] | null;
};

// Accessible uniquement aux super_admin/administrateur — la RLS
// (0005_audit_log_rls.sql) refuse déjà l'accès aux autres rôles ; on
// renvoie simplement une liste vide plutôt qu'une erreur si ce n'est pas
// encore appliqué en base (nouvelle migration pas encore exécutée).
export async function getAuditLog(limit = 100) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('audit_log')
    .select('id, table_name, record_id, action, created_at, user_id, profiles(full_name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as unknown as AuditEntry[];
}
