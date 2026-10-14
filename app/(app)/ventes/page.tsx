import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/permissions';
import { TEAM_SALES_ROLES } from '@/lib/users/roles';
import { formatAmount } from '@/components/dashboard/widgets';
import { documentTypeLabel, documentStatus } from '@/lib/documents/labels';

// Ventes de l'équipe (direction, 09/10) : chaque commercial voit les ventes de
// tout le monde (véhicule, montant, commercial, date, nom du client), mais
// jamais les coordonnées des clients des autres. Les données viennent de la
// fonction get_team_sales (migration 0032), qui ne renvoie que ces colonnes.
// Une commande déjà facturée n'apparaît qu'une fois, sous sa facture.

type Sale = {
  document_id: string;
  document_type: string;
  document_number: string | null;
  issue_date: string;
  status: string;
  total_amount: number;
  amount_paid: number;
  commercial_id: string | null;
  commercial_name: string | null;
  client_name: string;
  vehicles: string | null;
};

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export default async function TeamSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ annee?: string; mois?: string; commercial?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile || !TEAM_SALES_ROLES.includes(profile.role)) redirect('/dashboard');

  // Les rôles qui voient tous les documents peuvent ouvrir chaque vente ; un
  // commercial n'ouvre que les siennes.
  const canOpenAll = ['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes'].includes(
    profile.role
  );
  const { annee, mois, commercial } = await searchParams;
  const now = new Date();
  const year = Number(annee) >= 2020 && Number(annee) <= 2100 ? Number(annee) : now.getFullYear();
  const month = Number(mois) >= 1 && Number(mois) <= 12 ? Number(mois) : null;

  const from = month ? `${year}-${pad(month)}-01` : `${year}-01-01`;
  const to = month ? `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}` : `${year}-12-31`;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_team_sales', { p_from: from, p_to: to });
  const allSales = (data ?? []) as Sale[];

  const commercials = Array.from(
    new Map(allSales.filter((s) => s.commercial_id).map((s) => [s.commercial_id as string, s.commercial_name ?? 'Sans nom'])).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));
  const sales = commercial ? allSales.filter((s) => s.commercial_id === commercial) : allSales;

  const invoiced = sales.filter((s) => s.document_type === 'facture');
  const orders = sales.filter((s) => s.document_type === 'commande');
  const totalInvoiced = invoiced.reduce((sum, s) => sum + Number(s.total_amount), 0);
  const totalOrders = orders.reduce((sum, s) => sum + Number(s.total_amount), 0);
  const totalCollected = invoiced.reduce((sum, s) => sum + Number(s.amount_paid), 0);

  // Classement par commercial sur la période (factures + commandes en cours).
  const ranking = Array.from(
    allSales.reduce((map, s) => {
      const key = s.commercial_id ?? 'aucun';
      const row = map.get(key) ?? { name: s.commercial_name ?? 'Sans nom', count: 0, amount: 0 };
      row.count += 1;
      row.amount += Number(s.total_amount);
      map.set(key, row);
      return map;
    }, new Map<string, { name: string; count: number; amount: number }>())
  ).sort((a, b) => b[1].amount - a[1].amount);

  function href(next: { annee?: number; mois?: number | null; commercial?: string | null }) {
    const p = new URLSearchParams();
    p.set('annee', String(next.annee ?? year));
    const m = next.mois === undefined ? month : next.mois;
    if (m) p.set('mois', String(m));
    const c = next.commercial === undefined ? commercial : next.commercial;
    if (c) p.set('commercial', c);
    return `/ventes?${p.toString()}`;
  }

  const pill = (active: boolean) => `chip ${active ? 'chip-active' : ''}`;

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].filter((y) => y >= 2026);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Ventes de l&apos;équipe</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {month ? `${MONTHS[month - 1]} ${year}` : `Année ${year}`} · factures et commandes en cours de tous les commerciaux
        </p>
      </div>

      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {years.map((y) => (
            <Link key={y} href={href({ annee: y, mois: null })} className={pill(y === year && !month)}>
              {y}
            </Link>
          ))}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {MONTHS.map((m, i) => (
            <Link key={m} href={href({ mois: i + 1 })} className={pill(month === i + 1)}>
              {m.slice(0, 4)}
            </Link>
          ))}
        </div>
        {commercials.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            <Link href={href({ commercial: null })} className={pill(!commercial)}>
              Tous les commerciaux
            </Link>
            {commercials.map(([id, name]) => (
              <Link key={id} href={href({ commercial: id })} className={pill(commercial === id)}>
                {name}
              </Link>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Impossible de charger les ventes : {error.message}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs text-gray-500">Facturé ({invoiced.length})</p>
          <p className="num mt-1 text-xl font-semibold text-gray-900">{formatAmount(totalInvoiced)} FCFA</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">Encaissé sur ces factures</p>
          <p className="num mt-1 text-xl font-semibold text-gray-900">{formatAmount(totalCollected)} FCFA</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">Commandes à facturer ({orders.length})</p>
          <p className="num mt-1 text-xl font-semibold text-gray-900">{formatAmount(totalOrders)} FCFA</p>
        </div>
      </div>

      {ranking.length > 1 && !commercial && (
        <div className="card overflow-hidden">
          <p className="px-5 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100">Par commercial</p>
          <ul className="divide-y divide-gray-100">
            {ranking.map(([id, r]) => (
              <li key={id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className={id === profile.id ? 'font-semibold text-kf-navy' : 'text-gray-700'}>
                  {r.name}
                  {id === profile.id ? ' (vous)' : ''}
                </span>
                <span className="text-gray-500">
                  {r.count} vente{r.count > 1 ? 's' : ''} ·{' '}
                  <span className="num font-medium text-gray-900">{formatAmount(r.amount)} FCFA</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card overflow-hidden">
        {sales.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-gray-500">Aucune vente sur cette période.</p>
        ) : (
          <>
            <table className="hidden md:table w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50/60">
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">Document</th>
                  <th className="px-3 py-2.5 font-medium">Véhicule / articles</th>
                  <th className="px-3 py-2.5 font-medium">Client</th>
                  <th className="px-3 py-2.5 font-medium">Commercial</th>
                  <th className="px-3 py-2.5 font-medium text-right">Montant</th>
                  <th className="px-5 py-2.5 font-medium text-right">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sales.map((s) => {
                  const st = documentStatus(s.status, s.document_type);
                  const mine = s.commercial_id === profile.id;
                  return (
                    <tr key={s.document_id} className={mine ? 'bg-orange-50/40' : undefined}>
                      <td className="px-5 py-3 text-gray-500 whitespace-nowrap">
                        {new Date(s.issue_date).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="block text-xs text-gray-500">{documentTypeLabel(s.document_type)}</span>
                        {mine || canOpenAll ? (
                          <Link href={`/documents/${s.document_id}`} className="font-medium text-gray-900 hover:text-kf-navy">
                            {s.document_number}
                          </Link>
                        ) : (
                          <span className="font-medium text-gray-900">{s.document_number}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-gray-700 max-w-[240px] truncate">{s.vehicles ?? '-'}</td>
                      <td className="px-3 py-3 text-gray-700 max-w-[200px] truncate">{s.client_name}</td>
                      <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{s.commercial_name ?? '-'}</td>
                      <td className="num px-3 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                        {formatAmount(Number(s.total_amount))}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className={st.badge}>{st.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <ul className="md:hidden divide-y divide-gray-100">
              {sales.map((s) => {
                const st = documentStatus(s.status, s.document_type);
                return (
                  <li key={s.document_id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-900 truncate">{s.vehicles ?? '-'}</span>
                        <span className="block text-xs text-gray-500 truncate">
                          {s.client_name} · {s.commercial_name ?? '-'}
                        </span>
                        <span className="block text-xs text-gray-400">
                          {documentTypeLabel(s.document_type)} {s.document_number} ·{' '}
                          {new Date(s.issue_date).toLocaleDateString('fr-FR')}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="num block text-sm font-medium text-gray-900">{formatAmount(Number(s.total_amount))}</span>
                        <span className={`${st.badge} mt-1`}>{st.label}</span>
                      </span>
                    </div>
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
