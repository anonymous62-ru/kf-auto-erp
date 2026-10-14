import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentRole } from '@/lib/permissions';
import { formatAmount } from '@/components/dashboard/widgets';
import { LEAD_SOURCES } from '@/lib/crm/labels';
import { PrintButton } from '@/components/crm/print-button';

// Rapports de la direction (étape 4) : ventes, activité par commercial,
// affaires, origine des leads et stock, sur la période choisie. Tous les
// chiffres viennent de la fonction report_summary (migration 0035).

type Report = {
  period: { from: string; to: string };
  sales: {
    invoiced: number;
    credited?: number;
    invoices: number;
    collected: number;
    unpaid_total: number;
    proformas: number;
    proformas_amount: number;
    orders: number;
    orders_to_invoice: number;
    vehicles_sold: number;
  };
  by_month: { month: string; invoiced: number; collected: number; invoices: number }[];
  by_model: { model: string; quantity: number; amount: number }[];
  by_commercial: {
    id: string;
    name: string | null;
    proformas: number;
    orders: number;
    invoices: number;
    invoiced: number;
    collected: number;
    leads: number;
    deals_won: number;
    deals_lost: number;
    deals_open: number;
    pipeline: number;
    events_done: number;
  }[];
  stock: {
    model: string;
    tracked: boolean;
    in_stock: number;
    value: number;
    free: number;
    reserved: number;
    other: number;
    avg_age_days: number | null;
    over_90_days: number;
    sold_period: number;
  }[];
  parts: { references: number; below_min: number; to_activate: number };
  leads_by_source: { source: string; count: number; converted: number }[];
  deals: { open: number; pipeline: number; hot: number; won: number; lost: number; lost_reasons: { reason: string; count: number }[] };
  catalogues?: {
    sent: number;
    opened: number;
    whatsapp: number;
    email: number;
    by_commercial: { name: string; sent: number; opened: number }[];
    by_model: { name: string; sent: number }[];
  };
};

const PERIODS = [
  { value: 'mois', label: 'Ce mois' },
  { value: 'mois_precedent', label: 'Mois dernier' },
  { value: 'trimestre', label: 'Ce trimestre' },
  { value: 'annee', label: 'Cette année' },
  { value: 'annee_precedente', label: 'Année dernière' },
] as const;

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const iso = (d: Date) => d.toISOString().slice(0, 10);

function periodRange(p: string, du?: string, au?: string): { from: string; to: string; label: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const ok = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (p === 'perso' && ok(du) && ok(au) && (du as string) <= (au as string)) {
    return { from: du as string, to: au as string, label: 'Période choisie' };
  }
  if (p === 'mois_precedent') return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))), label: 'Mois dernier' };
  if (p === 'trimestre') {
    const q = Math.floor(m / 3) * 3;
    return { from: iso(new Date(Date.UTC(y, q, 1))), to: iso(new Date(Date.UTC(y, q + 3, 0))), label: 'Ce trimestre' };
  }
  if (p === 'annee') return { from: `${y}-01-01`, to: `${y}-12-31`, label: `Année ${y}` };
  if (p === 'annee_precedente') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: `Année ${y - 1}` };
  return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))), label: 'Ce mois' };
}

const fr = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : '-');

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ periode?: string; du?: string; au?: string }> }) {
  const role = await getCurrentRole();
  if (!['super_admin', 'administrateur', 'manager', 'admin_ventes', 'chef_service'].includes(role ?? '')) redirect('/dashboard');
  const { periode, du, au } = await searchParams;
  const range = periodRange(periode ?? 'mois', du, au);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('report_summary', { p_from: range.from, p_to: range.to });
  const r = data as Report | null;

  const pill = (active: boolean) => `chip ${active ? 'chip-active' : ''}`;
  const current = periode === 'perso' && range.label === 'Période choisie' ? 'perso' : (periode ?? 'mois');

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Rapports</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {range.label} · du {fr(range.from)} au {fr(range.to)}
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="card p-3 sm:p-4 space-y-3 print:hidden">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {PERIODS.map((p) => (
            <Link key={p.value} href={`/rapports?periode=${p.value}`} className={pill(current === p.value)}>
              {p.label}
            </Link>
          ))}
        </div>
        <form action="/rapports" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="periode" value="perso" />
          <label className="text-xs text-gray-500">
            Du
            <input type="date" name="du" defaultValue={range.from} className="input mt-1" />
          </label>
          <label className="text-xs text-gray-500">
            Au
            <input type="date" name="au" defaultValue={range.to} className="input mt-1" />
          </label>
          <button type="submit" className="btn-secondary">
            Afficher
          </button>
        </form>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {/report_summary/.test(error.message)
            ? "Les rapports ne sont pas encore installés dans la base (migration 0035)."
            : error.message}
        </p>
      )}

      {r && (
        <>
          {/* ---------- Ventes ---------- */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500">Ventes</h2>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: 'Facturé',
                  value: `${formatAmount(r.sales.invoiced - Number(r.sales.credited ?? 0))} FCFA`,
                  hint:
                    `${r.sales.invoices} facture${r.sales.invoices > 1 ? 's' : ''}` +
                    (Number(r.sales.credited ?? 0) > 0 ? `, avoirs déduits : ${formatAmount(Number(r.sales.credited))} FCFA` : ''),
                },
                { label: 'Encaissé', value: `${formatAmount(r.sales.collected)} FCFA`, hint: 'paiements reçus sur la période' },
                { label: 'Véhicules vendus', value: String(r.sales.vehicles_sold), hint: 'sur les factures de la période' },
                {
                  label: 'Transformation',
                  value: pct(r.sales.invoices, r.sales.proformas),
                  hint: `${r.sales.proformas} proforma${r.sales.proformas > 1 ? 's' : ''} → ${r.sales.invoices} facture${r.sales.invoices > 1 ? 's' : ''}`,
                },
                { label: 'Reste à encaisser', value: `${formatAmount(r.sales.unpaid_total)} FCFA`, hint: 'toutes factures ouvertes' },
                { label: 'Commandes à facturer', value: String(r.sales.orders_to_invoice), hint: "chez l'administration des ventes" },
                { label: 'Proformas émises', value: String(r.sales.proformas), hint: `${formatAmount(r.sales.proformas_amount)} FCFA` },
                { label: 'Commandes passées', value: String(r.sales.orders), hint: 'sur la période' },
              ].map((t) => (
                <div key={t.label} className="card p-3 sm:p-4">
                  <p className="text-xs text-gray-500">{t.label}</p>
                  <p className="num mt-1 text-lg font-semibold text-gray-900">{t.value}</p>
                  <p className="text-xs text-gray-500">{t.hint}</p>
                </div>
              ))}
            </div>

            {r.by_month.length > 1 && <MonthlyChart months={r.by_month} />}

            {r.by_model.length > 0 && (
              <div className="card overflow-hidden">
                <p className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100">Ventes par modèle</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 bg-gray-50/60">
                      <th className="px-4 py-2 font-medium">Modèle</th>
                      <th className="px-3 py-2 font-medium text-right">Quantité</th>
                      <th className="px-4 py-2 font-medium text-right">Montant (FCFA)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {r.by_model.map((m) => (
                      <tr key={m.model}>
                        <td className="px-4 py-2">{m.model}</td>
                        <td className="num px-3 py-2 text-right">{Number(m.quantity)}</td>
                        <td className="num px-4 py-2 text-right">{formatAmount(Number(m.amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ---------- Activité par commercial ---------- */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500">Activité par commercial</h2>
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 bg-gray-50/60 border-b border-gray-100">
                    <th className="px-4 py-2 font-medium">Commercial</th>
                    <th className="px-2 py-2 font-medium text-right">Leads</th>
                    <th className="px-2 py-2 font-medium text-right">Proformas</th>
                    <th className="px-2 py-2 font-medium text-right">Commandes</th>
                    <th className="px-2 py-2 font-medium text-right">Factures</th>
                    <th className="px-2 py-2 font-medium text-right">Transfo.</th>
                    <th className="px-2 py-2 font-medium text-right">Facturé</th>
                    <th className="px-2 py-2 font-medium text-right">Encaissé</th>
                    <th className="px-2 py-2 font-medium text-right">Affaires en cours</th>
                    <th className="px-2 py-2 font-medium text-right">Gagnées / perdues</th>
                    <th className="px-4 py-2 font-medium text-right">RDV faits</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {r.by_commercial.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-2 font-medium text-gray-900 whitespace-nowrap">{c.name ?? '-'}</td>
                      <td className="num px-2 py-2 text-right">{c.leads}</td>
                      <td className="num px-2 py-2 text-right">{c.proformas}</td>
                      <td className="num px-2 py-2 text-right">{c.orders}</td>
                      <td className="num px-2 py-2 text-right">{c.invoices}</td>
                      <td className="num px-2 py-2 text-right">{pct(c.invoices, c.proformas)}</td>
                      <td className="num px-2 py-2 text-right whitespace-nowrap">{formatAmount(Number(c.invoiced))}</td>
                      <td className="num px-2 py-2 text-right whitespace-nowrap">{formatAmount(Number(c.collected))}</td>
                      <td className="num px-2 py-2 text-right whitespace-nowrap">
                        {c.deals_open} <span className="text-gray-400">· {formatAmount(Number(c.pipeline))}</span>
                      </td>
                      <td className="num px-2 py-2 text-right">
                        {c.deals_won} / {c.deals_lost}
                      </td>
                      <td className="num px-4 py-2 text-right">{c.events_done}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ---------- Affaires et leads ---------- */}
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="card p-4 space-y-3">
              <h2 className="text-sm font-semibold text-gray-900">Affaires</h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <p>
                  <span className="block text-xs text-gray-500">En cours</span>
                  {r.deals.open} · <span className="num">{formatAmount(r.deals.pipeline)} FCFA</span>
                </p>
                <p>
                  <span className="block text-xs text-gray-500">Chaudes</span>
                  {r.deals.hot}
                </p>
                <p>
                  <span className="block text-xs text-gray-500">Gagnées (période)</span>
                  {r.deals.won}
                </p>
                <p>
                  <span className="block text-xs text-gray-500">Perdues (période)</span>
                  {r.deals.lost}
                </p>
              </div>
              {r.deals.lost_reasons.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Raisons des affaires perdues</p>
                  <ul className="text-sm space-y-0.5">
                    {r.deals.lost_reasons.map((l) => (
                      <li key={l.reason} className="flex justify-between gap-3">
                        <span className="truncate">{l.reason}</span>
                        <span className="num text-gray-500">{l.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="card overflow-hidden">
              <p className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100">Origine des leads (période)</p>
              {r.leads_by_source.length === 0 ? (
                <p className="px-4 py-4 text-sm text-gray-500">Aucun lead créé sur la période.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 bg-gray-50/60">
                      <th className="px-4 py-2 font-medium">Origine</th>
                      <th className="px-3 py-2 font-medium text-right">Leads</th>
                      <th className="px-4 py-2 font-medium text-right">Transformés</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {r.leads_by_source.map((s) => (
                      <tr key={s.source}>
                        <td className="px-4 py-2">{LEAD_SOURCES[s.source] ?? s.source}</td>
                        <td className="num px-3 py-2 text-right">{s.count}</td>
                        <td className="num px-4 py-2 text-right">
                          {s.converted} <span className="text-gray-400">({pct(s.converted, s.count)})</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100">
                Le détail par campagne marketing est dans{' '}
                <Link href="/campagnes" className="text-kf-navy underline">
                  Campagnes
                </Link>
                .
              </p>
            </div>
            {r.catalogues && (
              <div className="card overflow-hidden">
                <p className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100">Catalogues envoyés (période)</p>
                <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100 text-center">
                  <div className="px-2 py-3">
                    <p className="num text-lg font-semibold text-gray-900">{r.catalogues.sent}</p>
                    <p className="text-xs text-gray-500">envoyés</p>
                  </div>
                  <div className="px-2 py-3">
                    <p className="num text-lg font-semibold text-gray-900">{r.catalogues.opened}</p>
                    <p className="text-xs text-gray-500">ouverts ({pct(r.catalogues.opened, r.catalogues.sent)})</p>
                  </div>
                  <div className="px-2 py-3">
                    <p className="num text-lg font-semibold text-gray-900">{r.catalogues.whatsapp}</p>
                    <p className="text-xs text-gray-500">par WhatsApp</p>
                  </div>
                </div>
                {r.catalogues.by_commercial.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-gray-500">Aucun catalogue envoyé sur la période.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 bg-gray-50/60">
                        <th className="px-4 py-2 font-medium">Envoyé par</th>
                        <th className="px-3 py-2 font-medium text-right">Envois</th>
                        <th className="px-4 py-2 font-medium text-right">Ouverts</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {r.catalogues.by_commercial.map((c) => (
                        <tr key={c.name}>
                          <td className="px-4 py-2">{c.name}</td>
                          <td className="num px-3 py-2 text-right">{c.sent}</td>
                          <td className="num px-4 py-2 text-right">
                            {c.opened} <span className="text-gray-400">({pct(c.opened, c.sent)})</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {r.catalogues.by_model.length > 0 && (
                  <p className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100">
                    Modèles les plus envoyés : {r.catalogues.by_model.slice(0, 3).map((m) => `${m.name} (${m.sent})`).join(', ')}
                  </p>
                )}
              </div>
            )}
          </section>

          {/* ---------- Stock ---------- */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500">Stock</h2>
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 bg-gray-50/60 border-b border-gray-100">
                    <th className="px-4 py-2 font-medium">Modèle</th>
                    <th className="px-2 py-2 font-medium text-right">En stock</th>
                    <th className="px-2 py-2 font-medium text-right">Libres</th>
                    <th className="px-2 py-2 font-medium text-right">Attribués / réservés</th>
                    <th className="px-2 py-2 font-medium text-right">Démo, essais, endommagés</th>
                    <th className="px-2 py-2 font-medium text-right">Ancienneté moy.</th>
                    <th className="px-2 py-2 font-medium text-right">+ de 3 mois</th>
                    <th className="px-2 py-2 font-medium text-right">Vendus (période)</th>
                    <th className="px-4 py-2 font-medium text-right">Valeur (prix de vente)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {r.stock.map((s) => (
                    <tr key={s.model}>
                      <td className="px-4 py-2 whitespace-nowrap">{s.model}</td>
                      <td className="num px-2 py-2 text-right">{Number(s.in_stock)}</td>
                      <td className="num px-2 py-2 text-right">{s.tracked ? s.free : '-'}</td>
                      <td className="num px-2 py-2 text-right">{s.tracked ? s.reserved : '-'}</td>
                      <td className="num px-2 py-2 text-right">{s.tracked ? s.other : '-'}</td>
                      <td className="num px-2 py-2 text-right">{s.avg_age_days != null ? `${s.avg_age_days} j` : '-'}</td>
                      <td className={`num px-2 py-2 text-right ${s.over_90_days > 0 ? 'text-orange-600' : ''}`}>{s.tracked ? s.over_90_days : '-'}</td>
                      <td className="num px-2 py-2 text-right">{Number(s.sold_period)}</td>
                      <td className="num px-4 py-2 text-right whitespace-nowrap">{formatAmount(Number(s.value))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500">
              « - » : modèle pas encore suivi par numéro de châssis. Pièces détachées : {r.parts.references} référence
              {r.parts.references > 1 ? 's' : ''} active{r.parts.references > 1 ? 's' : ''}, {r.parts.below_min} sous le seuil,{' '}
              {r.parts.to_activate} en attente d&apos;activation.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

// Facturé par mois : une seule série, barres fines à angle arrondi en haut,
// valeur au survol (title) et tableau sous le graphique.
function MonthlyChart({ months }: { months: Report['by_month'] }) {
  const max = Math.max(1, ...months.map((m) => Number(m.invoiced)));
  const best = months.reduce((a, b) => (Number(b.invoiced) > Number(a.invoiced) ? b : a), months[0]);
  const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-gray-900">Facturé par mois</p>
        <p className="text-xs text-gray-500">FCFA</p>
      </div>
      <div className="flex h-44 items-end gap-1.5 border-b border-gray-200" role="img" aria-label="Montant facturé par mois">
        {months.map((m) => {
          const v = Number(m.invoiced);
          const h = Math.max(v > 0 ? 2 : 0, (v / max) * 100);
          return (
            <div key={m.month} className="group relative flex h-full flex-1 flex-col justify-end">
              {m.month === best.month && v > 0 && (
                <span className="num absolute -top-0.5 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap text-[11px] text-gray-600">
                  {formatAmount(v)}
                </span>
              )}
              <div
                className="mx-auto w-full max-w-[28px] rounded-t bg-kf-navy transition-opacity group-hover:opacity-80"
                style={{ height: `${h}%` }}
                title={`${label(m.month)} : ${formatAmount(v)} FCFA facturés, ${formatAmount(Number(m.collected))} FCFA encaissés, ${m.invoices} facture(s)`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        {months.map((m) => (
          <span key={m.month} className="flex-1 text-center text-[11px] text-gray-500">
            {label(m.month)}
          </span>
        ))}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-kf-navy">Voir le tableau</summary>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="py-1 font-medium">Mois</th>
              <th className="py-1 font-medium text-right">Facturé</th>
              <th className="py-1 font-medium text-right">Encaissé</th>
              <th className="py-1 font-medium text-right">Factures</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {months.map((m) => (
              <tr key={m.month}>
                <td className="py-1">{label(m.month)}</td>
                <td className="num py-1 text-right">{formatAmount(Number(m.invoiced))}</td>
                <td className="num py-1 text-right">{formatAmount(Number(m.collected))}</td>
                <td className="num py-1 text-right">{m.invoices}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
