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

  // Compteurs discrets de la barre latérale (chacun ne compte que ce que la
  // base lui laisse voir).
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lome' });
  const [leads, deals, overdue, vehicles] = await Promise.all([
    supabase.from('prospects').select('id', { count: 'exact', head: true }).not('status', 'in', '(converti,perdu)'),
    supabase.from('deals').select('id', { count: 'exact', head: true }).in('stage', ['decouverte', 'proforma', 'negociation', 'commande']),
    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('document_type', 'facture')
      .gt('balance_due', 0)
      .lt('due_date', today)
      .not('status', 'in', '(paye,annule)'),
    supabase.from('vehicle_units').select('id', { count: 'exact', head: true }).neq('status', 'vendu'),
  ]);
  const counts: Record<string, number> = {
    '/prospects': leads.count ?? 0,
    '/affaires': deals.count ?? 0,
    '/impayes': overdue.count ?? 0,
    '/stock': vehicles.count ?? 0,
  };
  const navigation = getNavigation(role).map((g) => ({
    ...g,
    items: g.items.map((i) => (counts[i.href] ? { ...i, count: counts[i.href] } : i)),
  }));

  return (
    <>
      <SyncProvider />
      <AppShell
        navigation={navigation}
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
