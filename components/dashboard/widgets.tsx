// Briques visuelles du tableau de bord. Composants purement "présentation"
// (aucun accès aux données ici) : la page récupère les chiffres réels et
// les passe en props. Aucun chiffre n'est inventé : tout ce qui s'affiche
// vient de la base.
import Link from 'next/link';
import { IconChevronRight, IconPlus } from '@/components/icons';
import { DOCUMENT_TYPE_LABELS, documentStatus } from '@/lib/documents/labels';

export function formatAmount(amount: number) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(amount)).replace(/[  ]/g, ' ');
}

export function formatCompact(amount: number) {
  if (amount >= 1_000_000) {
    const v = (amount / 1_000_000).toFixed(1).replace('.', ',').replace(',0', '');
    return `${v} M`;
  }
  if (amount >= 1_000) return `${Math.round(amount / 1_000)} k`;
  return String(Math.round(amount));
}

function formatShortDate(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

type Tone = 'navy' | 'red' | 'orange' | 'green' | 'gray';

const ICON_TONES: Record<Tone, string> = {
  navy: 'bg-kf-navy/[0.07] text-kf-navy',
  red: 'bg-red-50 text-kf-red',
  orange: 'bg-orange-50 text-orange-600',
  green: 'bg-emerald-50 text-emerald-600',
  gray: 'bg-gray-100 text-gray-500',
};

const HINT_TONES: Record<Tone, string> = {
  navy: 'text-gray-500',
  red: 'text-red-600',
  orange: 'text-orange-600',
  green: 'text-emerald-600',
  gray: 'text-gray-500',
};

// ---------------------------------------------------------------------------
// Indicateur clé
// ---------------------------------------------------------------------------
export function KpiCard({
  label,
  value,
  unit,
  hint,
  hintTone = 'gray',
  icon,
  tone = 'navy',
  href,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  hintTone?: Tone;
  icon: React.ReactNode;
  tone?: Tone;
  href?: string;
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-gray-500 leading-5">{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${ICON_TONES[tone]}`}>{icon}</span>
      </div>
      <p className="mt-2 flex items-baseline gap-1.5 flex-wrap">
        <span className="num text-xl sm:text-2xl font-semibold tracking-tight text-gray-900">{value}</span>
        {unit && <span className="text-xs font-medium text-gray-400">{unit}</span>}
      </p>
      {hint && <p className={`mt-1 text-xs ${HINT_TONES[hintTone]}`}>{hint}</p>}
    </>
  );
  const className = 'card p-4 sm:p-5 block';
  return href ? (
    <Link href={href} className={`${className} card-hover`}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

// ---------------------------------------------------------------------------
// Encaissements des derniers mois (barres en CSS : pas de dépendance
// graphique côté client, rendu immédiat même sur un téléphone d'entrée de
// gamme).
// ---------------------------------------------------------------------------
export function RevenueChart({ months }: { months: { label: string; amount: number; current?: boolean }[] }) {
  const max = Math.max(...months.map((m) => m.amount), 0);
  const total = months.reduce((s, m) => s + m.amount, 0);
  // Échelle arrondie au-dessus du maximum, pour des repères lisibles.
  const scale = max > 0 ? niceCeil(max) : 1;

  return (
    <div className="card h-full flex flex-col">
      <div className="card-header">
        <div>
          <h2 className="card-title">Encaissements</h2>
          <p className="text-xs text-gray-500 mt-0.5">Paiements enregistrés, 6 derniers mois</p>
        </div>
        <div className="text-right">
          <p className="num text-sm font-semibold text-gray-900">{formatAmount(total)} FCFA</p>
          <p className="text-xs text-gray-500">sur la période</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-end px-5 pt-6 pb-4">
        <div className="relative h-52">
          {[1, 0.5, 0].map((f) => (
            <div key={f} className="absolute left-0 right-0 flex items-center gap-2" style={{ bottom: `${f * 100}%` }}>
              <span className="num w-10 shrink-0 text-right text-[11px] text-gray-400 -translate-y-px">
                {max > 0 ? formatCompact(scale * f) : f === 0 ? '0' : ''}
              </span>
              <span className={`h-px flex-1 ${f === 0 ? 'bg-gray-200' : 'bg-gray-100'}`} />
            </div>
          ))}
          <div className="absolute inset-0 left-12 flex items-end gap-2 sm:gap-4">
            {months.map((m) => {
              const pct = max > 0 ? (m.amount / scale) * 100 : 0;
              return (
                <div key={m.label} className="flex h-full flex-1 flex-col items-center justify-end">
                  {m.current && m.amount > 0 && (
                    <span className="num mb-1 text-[11px] font-medium text-kf-navy">{formatCompact(m.amount)}</span>
                  )}
                  <div
                    title={`${m.label} : ${formatAmount(m.amount)} FCFA`}
                    className={`w-full max-w-[44px] rounded-t ${m.current ? 'bg-kf-navy' : 'bg-kf-navy/20'}`}
                    style={{ height: m.amount > 0 ? `max(${pct}%, 3px)` : '0px' }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-2 ml-12 flex gap-2 sm:gap-4">
          {months.map((m) => (
            <span
              key={m.label}
              className={`flex-1 text-center text-[11px] capitalize ${m.current ? 'font-medium text-gray-900' : 'text-gray-400'}`}
            >
              {m.label}
            </span>
          ))}
        </div>
        {max === 0 && (
          <p className="mt-3 text-center text-xs text-gray-400">Aucun paiement enregistré sur cette période.</p>
        )}
      </div>
    </div>
  );
}

function niceCeil(value: number) {
  const exponent = Math.floor(Math.log10(value));
  const base = Math.pow(10, exponent);
  const steps = [1, 2, 2.5, 5, 10];
  for (const s of steps) {
    if (value <= s * base) return s * base;
  }
  return 10 * base;
}

// ---------------------------------------------------------------------------
// Liste "À traiter"
// ---------------------------------------------------------------------------
export interface TaskItem {
  label: string;
  description: string;
  count: number;
  href: string;
  tone: Tone;
}

export function TaskList({ title = 'À traiter', items }: { title?: string; items: TaskItem[] }) {
  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">{title}</h2>
      </div>
      <ul className="divide-y divide-gray-100">
        {items.map((item) => {
          const tone: Tone = item.count > 0 ? item.tone : 'gray';
          return (
            <li key={item.label}>
              <Link href={item.href} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-gray-50">
                <span
                  className={`num flex h-9 min-w-[36px] items-center justify-center rounded-lg px-1.5 text-sm font-semibold ${ICON_TONES[tone]}`}
                >
                  {item.count}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900">{item.label}</span>
                  <span className="block text-xs text-gray-500 truncate">{item.description}</span>
                </span>
                <IconChevronRight className="w-4 h-4 shrink-0 text-gray-300" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Derniers documents
// ---------------------------------------------------------------------------
export interface RecentDocument {
  id: string;
  number: string | null;
  type: string;
  status: string;
  client: string;
  date: string | null;
  total: number;
}

export function RecentDocuments({
  title = 'Derniers documents',
  documents,
  createHref,
  createLabel,
}: {
  title?: string;
  documents: RecentDocument[];
  createHref: string;
  createLabel: string;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="card-header">
        <h2 className="card-title">{title}</h2>
        <Link href="/documents" className="text-xs font-medium text-kf-navy hover:underline underline-offset-2">
          Tout voir
        </Link>
      </div>

      {documents.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-gray-500">Aucun document pour le moment.</p>
          <Link href={createHref} className="btn-secondary mt-3">
            <IconPlus className="w-4 h-4" /> {createLabel}
          </Link>
        </div>
      ) : (
        <>
          {/* Tableau (tablette / ordinateur) */}
          <table className="hidden md:table w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50/60">
                <th className="px-5 py-2.5 font-medium">Document</th>
                <th className="px-3 py-2.5 font-medium">Client</th>
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium text-right">Montant</th>
                <th className="px-5 py-2.5 font-medium text-right">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {documents.map((d) => {
                const status = documentStatus(d.status);
                return (
                  <tr key={d.id} className="group">
                    <td className="px-5 py-3">
                      <Link href={`/documents/${d.id}`} className="block">
                        <span className="block font-medium text-gray-900 group-hover:text-kf-navy">
                          {d.number ?? 'En attente de numéro'}
                        </span>
                        <span className="block text-xs text-gray-500">{DOCUMENT_TYPE_LABELS[d.type] ?? d.type}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-gray-700 max-w-[200px] truncate">{d.client}</td>
                    <td className="px-3 py-3 text-gray-500 whitespace-nowrap">{formatShortDate(d.date)}</td>
                    <td className="num px-3 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                      {formatAmount(d.total)} <span className="text-xs font-normal text-gray-400">FCFA</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className={status.badge}>{status.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Liste (téléphone) */}
          <ul className="md:hidden divide-y divide-gray-100">
            {documents.map((d) => {
              const status = documentStatus(d.status);
              return (
                <li key={d.id}>
                  <Link href={`/documents/${d.id}`} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-gray-50">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900 truncate">{d.client}</span>
                      <span className="block text-xs text-gray-500">
                        {DOCUMENT_TYPE_LABELS[d.type] ?? d.type} {d.number ?? ''} · {formatShortDate(d.date)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="num block text-sm font-medium text-gray-900">{formatAmount(d.total)}</span>
                      <span className={`${status.badge} mt-1`}>{status.label}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Atelier : ordres de réparation en cours
// ---------------------------------------------------------------------------
const OR_STATUS: Record<string, { label: string; badge: string }> = {
  ouvert: { label: 'Ouvert', badge: 'badge-navy' },
  en_cours: { label: 'En cours', badge: 'badge-orange' },
  en_attente_pieces: { label: 'Attente pièces', badge: 'badge-red' },
};

export interface OpenRepairOrder {
  id: string;
  number: string | null;
  vehicle: string;
  status: string;
  openedAt: string | null;
}

export function RepairOrdersCard({ orders, total }: { orders: OpenRepairOrder[]; total: number }) {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">Atelier en cours</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {total} ordre{total > 1 ? 's' : ''} de réparation ouvert{total > 1 ? 's' : ''}
          </p>
        </div>
        <Link href="/atelier" className="text-xs font-medium text-kf-navy hover:underline underline-offset-2">
          Ouvrir l&apos;atelier
        </Link>
      </div>
      {orders.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-500">Aucun véhicule en atelier actuellement.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {orders.map((o) => {
            const status = OR_STATUS[o.status] ?? { label: o.status, badge: 'badge-gray' };
            return (
              <li key={o.id}>
                <Link href={`/atelier/${o.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-gray-50">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900 truncate">{o.vehicle}</span>
                    <span className="block text-xs text-gray-500">
                      {o.number ?? 'OR'} · depuis le {formatShortDate(o.openedAt)}
                    </span>
                  </span>
                  <span className={status.badge}>{status.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Synthèse stock (véhicules + pièces)
// ---------------------------------------------------------------------------
export function StockSummary({
  rows,
}: {
  rows: { label: string; value: string; href: string; tone?: Tone; hint?: string }[];
}) {
  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Stock</h2>
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map((r) => (
          <Link key={r.label} href={r.href} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-gray-50">
            <span className="min-w-0">
              <span className="block text-sm text-gray-700">{r.label}</span>
              {r.hint && <span className="block text-xs text-gray-400">{r.hint}</span>}
            </span>
            <span className={`num text-sm font-semibold ${r.tone ? HINT_TONES[r.tone] : 'text-gray-900'}`}>{r.value}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
