import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getTeamOverview } from '@/lib/team/actions';
import { formatCFA } from '@/lib/documents/calculations';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { IconChevronRight } from '@/components/icons';

const ROLE_LABELS: Record<string, string> = {
  commercial: 'Commercial',
  vendeur_showroom: 'Chargé de vente showroom',
  responsable_showroom: 'Responsable showroom',
};

export default async function TeamActivityPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect('/login');

  let team;
  try {
    team = await getTeamOverview();
  } catch {
    redirect('/dashboard');
  }

  return (
    <div>
      <PageHeader
        title="Suivi des commerciaux"
        description="Activité des commerciaux et du showroom : clients, leads, documents, contrats et chiffre du mois."
      />

      {team.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Aucun commercial pour l'instant"
            description="Les comptes avec le rôle Commercial ou Showroom apparaîtront ici."
          />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {team.map((m) => (
            <Link
              key={m.id}
              href={`/team/${m.id}`}
              className={`card block p-4 transition-colors hover:bg-[#FAFBFC] ${m.is_active ? '' : 'opacity-60'}`}
            >
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-nuit text-xs font-semibold text-white">
                  {(m.full_name ?? '?')
                    .split(' ')
                    .filter(Boolean)
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-sm font-semibold">{m.full_name || 'Sans nom'}</b>
                  <span className="block text-xs text-encre-3">
                    {ROLE_LABELS[m.role] ?? m.role}
                    {!m.is_active && <span className="text-rouge">, compte désactivé</span>}
                  </span>
                </span>
                <IconChevronRight className="h-4 w-4 shrink-0 text-encre-3" />
              </div>

              <dl className="mt-4 grid grid-cols-4 gap-2">
                {[
                  ['Clients', m.clients_count],
                  ['Leads', m.prospects_actifs_count],
                  ['Documents', m.documents_count],
                  ['Contrats', m.contracts_count],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <dd className="num font-display text-lg font-bold">{value}</dd>
                    <dt className="text-xs text-encre-3">{label}</dt>
                  </div>
                ))}
              </dl>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-trait-2 pt-3 text-[13px]">
                <span>
                  <span className="text-encre-3">CA du mois </span>
                  <span className="num font-semibold">{formatCFA(m.revenue_month)}</span>
                </span>
                {m.unpaid_total > 0 && (
                  <span className="num font-medium text-rouge">Impayés {formatCFA(m.unpaid_total)}</span>
                )}
              </div>
              <p className="mt-1 text-xs text-encre-3">
                {m.last_activity_at
                  ? `Dernière activité le ${new Date(m.last_activity_at).toLocaleDateString('fr-FR')}`
                  : 'Aucune activité enregistrée'}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
