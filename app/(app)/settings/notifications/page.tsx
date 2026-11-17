import { redirect } from 'next/navigation';
import { NotificationSettingsForm } from '@/components/notifications/notification-settings-form';
import { getMe } from '@/lib/notifications/server';

export const dynamic = 'force-dynamic';

export default async function NotificationSettingsPage() {
  const me = await getMe();
  if (!me) redirect('/login');
  return (
    <div className="space-y-3">
      <h1 className="page-title">Notifications</h1>
      <p className="text-xs text-gray-500">
        Choisissez les e-mails que vous recevez. Les notifications de la cloche ne changent pas.
      </p>
      <NotificationSettingsForm
        initialNonUrgent={me.profile.email_non_urgent !== false}
        email={me.profile.email ?? null}
        canTest={me.profile.role === 'super_admin'}
      />
    </div>
  );
}
