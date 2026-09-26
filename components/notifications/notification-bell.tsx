'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  subscribeToNotifications,
  type NotificationRow,
} from '@/lib/notifications/client';
import { IconBell } from '@/components/icons';

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

export function NotificationBell() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    async function init() {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      try {
        setNotifications(await fetchNotifications());
      } catch {
        // silencieux : le badge reste simplement vide si la table n'est pas encore accessible
      }

      unsubscribe = subscribeToNotifications(userData.user.id, (row) => {
        setNotifications((prev) => [row, ...prev].slice(0, 20));
      });
    }
    void init();

    return () => unsubscribe?.();
  }, []);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  async function handleOpenNotification(n: NotificationRow) {
    if (!n.is_read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      await markNotificationRead(n.id);
    }
    setOpen(false);
    if (n.related_document_id) router.push(`/documents/${n.related_document_id}`);
  }

  async function handleMarkAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await markAllNotificationsRead();
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative text-white/90 px-1.5" aria-label="Notifications">
        <IconBell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-kf-red text-white text-[10px] leading-none rounded-full px-1.5 py-0.5">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-white text-gray-900 rounded-lg border shadow-lg z-20 max-h-96 overflow-y-auto">
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <span className="text-sm font-medium">Notifications</span>
              {unreadCount > 0 && (
                <button onClick={handleMarkAllRead} className="text-xs text-kf-navy underline">
                  Tout marquer lu
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <p className="text-sm text-gray-400 px-3 py-6 text-center">Aucune notification</p>
            ) : (
              <div className="divide-y">
                {notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleOpenNotification(n)}
                    className={`w-full text-left px-3 py-2.5 hover:bg-gray-50 ${!n.is_read ? 'bg-blue-50/50' : ''}`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.is_read && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-kf-red flex-shrink-0" />}
                      <div className="flex-1">
                        <p className="text-sm font-medium">{n.title}</p>
                        {n.message && <p className="text-xs text-gray-500">{n.message}</p>}
                        <p className="text-xs text-gray-400 mt-0.5">{timeAgo(n.created_at)}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
