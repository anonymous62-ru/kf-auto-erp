import { createClient } from '@/lib/supabase/server';
import { SyncProvider } from '@/components/offline/sync-provider';
import { OfflineStatusBadge } from '@/components/offline/status-badge';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { OrganizationBadge } from '@/components/organization-badge';
import { LogoutButton } from '@/components/auth/logout-button';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user?.id ?? '')
    .maybeSingle();

  const { data: organization } = await supabase
    .from('organizations')
    .select('name, logo_url')
    .eq('id', profile?.organization_id ?? '')
    .maybeSingle();

  return (
    <div className="min-h-screen">
      <SyncProvider />
      <header className="sticky top-0 z-10 shadow-md shadow-kf-navy/10">
        <div className="bg-gradient-to-r from-kf-navy to-[#25396b] text-white px-4 py-3 flex items-center justify-between">
          <a href="/dashboard" className="flex items-center gap-2 font-semibold text-sm group">
            <OrganizationBadge
              logoUrl={organization?.logo_url}
              name={organization?.name}
              className="h-7 w-7 rounded-lg bg-white/10 text-xs transition-colors group-hover:bg-white/20"
            />
            <span className="transition-transform group-hover:-translate-x-0.5">← Auto ERP</span>
          </a>
          <div className="flex items-center gap-3">
            <OfflineStatusBadge />
            <NotificationBell />
            <span className="text-xs opacity-80 hidden sm:inline">{user?.email}</span>
            <LogoutButton />
          </div>
        </div>
        <div className="brand-stripe">
          <span />
          <span />
          <span />
          <span />
        </div>
      </header>
      <main className="p-4 max-w-3xl mx-auto">{children}</main>
    </div>
  );
}
