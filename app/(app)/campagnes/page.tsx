import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listCampaigns } from '@/lib/crm/campaigns';
import { campaignStatus, channelLabel } from '@/lib/crm/labels';
import { formatAmount } from '@/components/dashboard/widgets';
import { getCurrentRole } from '@/lib/permissions';
import { IconPlus } from '@/components/icons';

// Campagnes du service marketing et communication (étape 4) : budget,
// dépenses, leads générés et ce qu'ils ont rapporté. Un lead est rattaché à
// sa campagne à sa création (champ "Campagne" du formulaire de lead).

const VIEW_ROLES = ['super_admin', 'administrateur', 'manager', 'marketing', 'admin_ventes', 'chef_service'];
const WRITE_ROLES = ['super_admin', 'administrateur', 'manager', 'marketing'];

export default async function CampaignsPage() {
  const role = await getCurrentRole();
  if (!VIEW_ROLES.includes(role ?? '')) redirect('/dashboard');
  const { campaigns, error } = await listCampaigns(true);
  const canWrite = WRITE_ROLES.includes(role ?? '');

  const totals = campaigns.reduce(
    (acc, c) => ({
      budget: acc.budget + c.budget,
      spent: acc.spent + c.spent,
      leads: acc.leads + (c.stats?.leads ?? 0),
      won: acc.won + (c.stats?.deals_won ?? 0),
    }),
    { budget: 0, spent: 0, leads: 0, won: 0 }
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Campagnes</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {formatAmount(totals.spent)} FCFA dépensés sur {formatAmount(totals.budget)} prévus · {totals.leads} lead
            {totals.leads > 1 ? 's' : ''} · {totals.won} affaire{totals.won > 1 ? 's' : ''} gagnée{totals.won > 1 ? 's' : ''}
          </p>
        </div>
        {canWrite && (
          <Link href="/campagnes/new" className="btn-primary">
            <IconPlus className="w-4 h-4" /> Nouvelle campagne
          </Link>
        )}
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="card overflow-hidden">
        {campaigns.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-500">
            Aucune campagne. Créez-en une, puis choisissez-la dans le champ « Campagne » des nouveaux leads.
          </p>
        ) : (
          <>
            <table className="hidden md:table w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50/60">
                  <th className="px-5 py-2.5 font-medium">Campagne</th>
                  <th className="px-3 py-2.5 font-medium text-right">Dépensé / budget</th>
                  <th className="px-3 py-2.5 font-medium text-right">Leads</th>
                  <th className="px-3 py-2.5 font-medium text-right">Coût par lead</th>
                  <th className="px-3 py-2.5 font-medium text-right">Catalogues (ouverts)</th>
                  <th className="px-3 py-2.5 font-medium text-right">Transformés</th>
                  <th className="px-3 py-2.5 font-medium text-right">Affaires gagnées</th>
                  <th className="px-5 py-2.5 font-medium text-right">Facturé</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {campaigns.map((c) => {
                  const st = campaignStatus(c.status);
                  const leads = c.stats?.leads ?? 0;
                  return (
                    <tr key={c.id} className="hover:bg-gray-50/70">
                      <td className="px-5 py-3">
                        <Link href={`/campagnes/${c.id}`} className="font-medium text-gray-900 hover:text-kf-navy">
                          {c.name}
                        </Link>
                        <span className="block text-xs text-gray-500">
                          {channelLabel(c.channel)} · {new Date(`${c.start_date}T00:00:00`).toLocaleDateString('fr-FR')}
                          {c.end_date ? ` au ${new Date(`${c.end_date}T00:00:00`).toLocaleDateString('fr-FR')}` : ''}{' '}
                          <span className={st.badge}>{st.label}</span>
                        </span>
                      </td>
                      <td className="num px-3 py-3 text-right whitespace-nowrap">
                        {formatAmount(c.spent)} <span className="text-gray-400">/ {formatAmount(c.budget)}</span>
                      </td>
                      <td className="num px-3 py-3 text-right">{leads}</td>
                      <td className="num px-3 py-3 text-right whitespace-nowrap">{leads ? formatAmount(c.spent / leads) : '-'}</td>
                      <td className="num px-3 py-3 text-right whitespace-nowrap">
                        {c.stats?.catalogues_sent ?? 0} <span className="text-gray-400">({c.stats?.catalogues_opened ?? 0})</span>
                      </td>
                      <td className="num px-3 py-3 text-right">{c.stats?.leads_converted ?? 0}</td>
                      <td className="num px-3 py-3 text-right">{c.stats?.deals_won ?? 0}</td>
                      <td className="num px-5 py-3 text-right whitespace-nowrap">{formatAmount(c.stats?.invoiced_amount ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ul className="md:hidden divide-y divide-gray-100">
              {campaigns.map((c) => {
                const st = campaignStatus(c.status);
                const leads = c.stats?.leads ?? 0;
                return (
                  <li key={c.id}>
                    <Link href={`/campagnes/${c.id}`} className="block px-4 py-3 hover:bg-gray-50">
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-gray-900 truncate">{c.name}</span>
                          <span className="block text-xs text-gray-500">{channelLabel(c.channel)}</span>
                        </span>
                        <span className={st.badge}>{st.label}</span>
                      </span>
                      <span className="mt-1 block text-xs text-gray-600">
                        {leads} lead{leads > 1 ? 's' : ''} · {leads ? `${formatAmount(c.spent / leads)} FCFA par lead · ` : ''}
                        {c.stats?.deals_won ?? 0} gagnée(s) · {formatAmount(c.spent)} / {formatAmount(c.budget)} FCFA
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
