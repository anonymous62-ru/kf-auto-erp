import { createClient } from '@/lib/supabase/server';
import { formatCFA } from '@/lib/documents/calculations';
import { PendingDocumentsWidget } from '@/components/offline/pending-documents-widget';
import { MfaNudgeBanner } from '@/components/security/mfa-nudge-banner';
import {
  IconCash,
  IconAlert,
  IconDocument,
  IconUsers,
  IconBox,
  IconArchive,
  IconLock,
  IconPlus,
  IconChevronRight,
  IconBuilding,
  IconTarget,
  IconDocument as IconContract,
} from '@/components/icons';
import { OrganizationBadge } from '@/components/organization-badge';

export default async function DashboardPage() {
  const supabase = await createClient();

  // Important : filtrer explicitement par son propre id. Sans ce filtre,
  // un administrateur (dont la policy RLS "profiles_select_admin" laisse
  // voir TOUS les profils de son organisation) reçoit plusieurs lignes ;
  // .single() exige exactement une ligne et plante silencieusement dans
  // ce cas, d'où le nom vide et le bouton "Gérer les utilisateurs" qui
  // disparaissait uniquement pour les comptes admin.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, organization_id')
    .eq('id', user?.id ?? '')
    .single();

  const { data: organization } = await supabase
    .from('organizations')
    .select('name, logo_url')
    .eq('id', profile?.organization_id ?? '')
    .maybeSingle();

  const { count: pendingDocs } = await supabase
    .from('documents')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'brouillon');

  const { count: clientsCount } = await supabase
    .from('clients')
    .select('*', { count: 'exact', head: true });

  const { count: activeProspectsCount } = await supabase
    .from('prospects')
    .select('*', { count: 'exact', head: true })
    .not('status', 'in', '(converti,perdu)');

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: monthDocs } = await supabase
    .from('documents')
    .select('total_amount, status')
    .eq('document_type', 'facture')
    .gte('issue_date', startOfMonth.toISOString().slice(0, 10));

  const revenueMonth = (monthDocs ?? [])
    .filter((d) => d.status === 'paye' || d.status === 'paye_partiel')
    .reduce((sum, d) => sum + Number(d.total_amount), 0);

  const { data: unpaid } = await supabase
    .from('documents')
    .select('balance_due')
    .gt('balance_due', 0)
    .in('status', ['envoye', 'paye_partiel']);

  const totalUnpaid = (unpaid ?? []).reduce((sum, d) => sum + Number(d.balance_due), 0);

  const firstName = (profile?.full_name ?? '').split(' ')[0];

  return (
    <div className="space-y-5">
      <div className="card p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400">Bienvenue</p>
          <h1 className="text-lg font-semibold text-kf-navy">Bonjour{firstName ? `, ${firstName}` : ''}</h1>
        </div>
        <OrganizationBadge
          logoUrl={organization?.logo_url}
          name={organization?.name}
          className="hidden sm:inline-flex h-10 w-10 rounded-xl bg-kf-navy/5 text-kf-navy"
        />
      </div>

      {profile?.role && <MfaNudgeBanner role={profile.role} />}

      <PendingDocumentsWidget />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="CA du mois" value={formatCFA(revenueMonth)} accent="border-l-green-500" icon={<IconCash />} />
        <StatCard
          label="Impayés"
          value={formatCFA(totalUnpaid)}
          accent="border-l-kf-red"
          valueClass="text-kf-red"
          icon={<IconAlert />}
        />
        <StatCard
          label="Documents en attente"
          value={String(pendingDocs ?? 0)}
          accent="border-l-kf-orange"
          icon={<IconDocument />}
        />
        <StatCard
          href="/clients"
          label="Clients"
          value={String(clientsCount ?? 0)}
          accent="border-l-kf-navy"
          icon={<IconUsers />}
        />
        <StatCard
          href="/prospects"
          label="Prospects actifs"
          value={String(activeProspectsCount ?? 0)}
          accent="border-l-purple-500"
          icon={<IconTarget />}
        />
      </div>

      <div className="space-y-2">
        <a href="/documents/new/devis" className="btn-primary w-full">
          <IconPlus className="w-4 h-4" /> Créer un document
        </a>
        <NavLink href="/prospects" icon={<IconTarget />} label="Voir les prospects" />
        <NavLink href="/contracts" icon={<IconContract />} label="Contrats de vente" />
        <NavLink href="/impayes" icon={<IconAlert />} label="Voir les impayés" />
        <NavLink href="/products" icon={<IconBox />} label="Voir les produits" />
        {profile && ['super_admin', 'administrateur'].includes(profile.role) && (
          <>
            <NavLink href="/team" icon={<IconUsers />} label="Suivi des commerciaux" />
            <NavLink href="/users" icon={<IconUsers />} label="Gérer les utilisateurs" />
            <NavLink href="/audit" icon={<IconArchive />} label="Journal d'audit" />
            <NavLink href="/settings/organisation" icon={<IconBuilding />} label="Organisation (logo, coordonnées)" />
          </>
        )}
        <NavLink href="/settings/security" icon={<IconLock />} label="Sécurité (2FA)" />
      </div>
    </div>
  );
}

function StatCard({
  href,
  label,
  value,
  icon,
  accent,
  valueClass,
}: {
  href?: string;
  label: string;
  value: string;
  icon: React.ReactNode;
  accent: string;
  valueClass?: string;
}) {
  const content = (
    <>
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{label}</p>
        <span className="text-gray-400">{icon}</span>
      </div>
      <p className={`text-lg font-semibold mt-1 ${valueClass ?? 'text-gray-900'}`}>{value}</p>
    </>
  );
  const className = `card card-hover border-l-4 ${accent} p-4`;
  return href ? (
    <a href={href} className={className}>
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}

function NavLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <a href={href} className="btn-secondary w-full justify-between">
      <span className="flex items-center gap-2">
        <span className="text-kf-navy/70">{icon}</span>
        {label}
      </span>
      <IconChevronRight className="w-4 h-4 text-gray-300" />
    </a>
  );
}
