import { createClient } from '@/lib/supabase/server';
import { SyncProvider } from '@/components/offline/sync-provider';
import { OfflineStatusBadge } from '@/components/offline/status-badge';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { AppShell } from '@/components/layout/app-shell';
import { getNavigation } from '@/lib/navigation';
import { roleLabel, type UserRole } from '@/lib/users/roles';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Filtre explicite par id : pour un admin, la RLS renvoie tous les profils
  // de l'organisation (voir le correctif du dashboard du 26/09).
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, full_name, role')
    .eq('id', user?.id ?? '')
    .maybeSingle();

  const { data: organization } = await supabase
    .from('organizations')
    .select('name, logo_url')
    .eq('id', profile?.organization_id ?? '')
    .maybeSingle();

  const role = (profile?.role ?? null) as UserRole | null;

  return (
    <>
      <SyncProvider />
      <AppShell
        navigation={getNavigation(role)}
        organization={{ name: organization?.name, logoUrl: organization?.logo_url }}
        user={{
          name: profile?.full_name ?? '',
          email: user?.email ?? '',
          roleLabel: role ? roleLabel(role) : '',
        }}
        topbarRight={
          <>
            <OfflineStatusBadge />
            <NotificationBell />
          </>
        }
      >
        {children}
      </AppShell>
    </>
  );
}
