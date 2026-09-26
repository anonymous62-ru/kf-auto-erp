// Lecture/écriture des notifications côté navigateur, avec abonnement
// temps réel (Supabase Realtime) pour un badge qui se met à jour sans
// recharger la page.
import { createClient } from '@/lib/supabase/client';

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string | null;
  is_read: boolean;
  related_document_id: string | null;
  created_at: string;
}

export async function fetchNotifications(limit = 20): Promise<NotificationRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, message, is_read, related_document_id, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function markNotificationRead(id: string) {
  const supabase = createClient();
  await supabase.from('notifications').update({ is_read: true }).eq('id', id);
}

export async function markAllNotificationsRead() {
  const supabase = createClient();
  await supabase.from('notifications').update({ is_read: true }).eq('is_read', false);
}

export function subscribeToNotifications(userId: string, onInsert: (row: NotificationRow) => void) {
  const supabase = createClient();
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload) => onInsert(payload.new as NotificationRow)
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
