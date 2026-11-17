// Lectures côté serveur des actions en attente (pages et compteurs).
// La RLS de action_items limite déjà : chacun voit ses actions, la direction
// voit celles de toute l'organisation.
import { createClient } from '@/lib/supabase/server';

export interface ActionItemRow {
  id: string;
  kind: string;
  title: string;
  message: string | null;
  link: string | null;
  document_id: string | null;
  payload: Record<string, unknown>;
  status: 'ouverte' | 'traitee' | 'annulee';
  created_at: string;
  done_at: string | null;
  assignee_id: string;
  assignee: { full_name: string | null } | null;
  requester: { full_name: string | null } | null;
  doneBy: { full_name: string | null } | null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export async function getMe() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, full_name, email, email_non_urgent')
    .eq('id', data.user.id)
    .maybeSingle();
  return profile ? { supabase, profile } : null;
}

export async function listActionItems(opts: { team: boolean; done: boolean; userId: string }): Promise<ActionItemRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from('action_items')
    .select(
      'id, kind, title, message, link, document_id, payload, status, created_at, done_at, assignee_id, ' +
        'assignee:profiles!action_items_assignee_id_fkey(full_name), ' +
        'requester:profiles!action_items_requested_by_fkey(full_name), ' +
        'doneBy:profiles!action_items_done_by_fkey(full_name)'
    );
  if (!opts.team) query = query.eq('assignee_id', opts.userId);
  if (opts.done) {
    const since = new Date(Date.now() - 14 * 86400000).toISOString();
    query = query.neq('status', 'ouverte').gte('done_at', since).order('done_at', { ascending: false }).limit(100);
  } else {
    query = query.eq('status', 'ouverte').order('created_at', { ascending: true }).limit(300);
  }
  const { data, error } = await query;
  if (error) return [];
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as ActionItemRow),
    payload: (r.payload as Record<string, unknown>) ?? {},
    assignee: one(r.assignee as ActionItemRow['assignee']),
    requester: one(r.requester as ActionItemRow['requester']),
    doneBy: one(r.doneBy as ActionItemRow['doneBy']),
  }));
}

export async function countMyPendingActions(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('my_pending_actions_count');
  if (error || typeof data !== 'number') return 0;
  return data;
}
