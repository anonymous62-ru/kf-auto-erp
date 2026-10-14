import Link from 'next/link';
import { listDeals, type DealRow } from '@/lib/crm/deals';
import { DEAL_STAGES, OPEN_STAGES, TEMPERATURES, dealStage, temperature } from '@/lib/crm/labels';
import { formatAmount } from '@/components/dashboard/widgets';
import { getCurrentProfile } from '@/lib/permissions';
import { clientDisplayName } from '@/lib/documents/labels';
import { IconPlus } from '@/components/icons';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { DealPipeline, type PipelineDeal } from '@/components/crm/deal-pipeline';

// Affaires (direction, 09/10/2026) : chaque opportunité de vente avec sa
// température. Les affaires ouvertes sont classées chaudes d'abord, puis par
// date de conclusion prévue.

type Search = { temp?: string; etape?: string; commercial?: string; vue?: string };

function contactName(d: DealRow) {
  if (d.client) return clientDisplayName(d.client);
  if (d.lead) return clientDisplayName(d.lead);
  return 'Contact non renseigné';
}

export default async function DealsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const me = await getCurrentProfile();
  const seesAll = ['super_admin', 'administrateur', 'manager', 'admin_ventes', 'chef_service'].includes(me?.role ?? '');
  const { deals, error } = await listDeals();

  const etape = params.etape ?? 'ouvertes';
  const commercials = Array.from(new Map(deals.map((d) => [d.assigned_to, d.owner?.full_name ?? 'Sans nom'])).entries()).sort((a, b) =>
    a[1].localeCompare(b[1])
  );
  const scoped = params.commercial ? deals.filter((d) => d.assigned_to === params.commercial) : deals;
  const open = scoped.filter((d) => OPEN_STAGES.includes(d.stage));
  const filtered = scoped
    .filter((d) =>
      etape === 'ouvertes' ? OPEN_STAGES.includes(d.stage) : etape === 'toutes' ? true : d.stage === etape
    )
    .filter((d) => (params.temp ? d.temperature === params.temp : true))
    .sort((a, b) => {
      const ta = TEMPERATURES.findIndex((t) => t.value === a.temperature);
      const tb = TEMPERATURES.findIndex((t) => t.value === b.temperature);
      if (ta !== tb) return ta - tb;
      return (a.expected_close_date ?? '9999').localeCompare(b.expected_close_date ?? '9999');
    });

  const won = scoped.filter((d) => d.stage === 'gagnee');
  const today = new Date().toISOString().slice(0, 10);

  function href(next: Partial<Search>) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...next })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/affaires?${s}` : '/affaires';
  }
  const pill = (active: boolean) => `chip ${active ? 'chip-active' : ''}`;
  const view = params.vue === 'liste' ? 'liste' : 'pipeline';
  // Pipeline : affaires en cours + affaires clôturées depuis 90 jours.
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const pipelineDeals: PipelineDeal[] = scoped
    .filter((d) => OPEN_STAGES.includes(d.stage) || (d.closed_at ?? d.updated_at) >= since)
    .sort((a, b) => (a.expected_close_date ?? '9999').localeCompare(b.expected_close_date ?? '9999'))
    .map((d) => ({
      id: d.id,
      title: d.title,
      contact: contactName(d),
      product: d.product ? `${d.product.designation}${d.quantity > 1 ? ` x${d.quantity}` : ''}` : null,
      owner: d.owner?.full_name ?? null,
      amount: d.estimated_amount,
      temperature: d.temperature,
      stage: d.stage,
      stageLabel: dealStage(d.stage).label,
      expectedClose: d.expected_close_date,
    }));
  const viewHref = (v: string) => href({ vue: v === 'liste' ? 'liste' : undefined });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Affaires"
        description={`${open.length} en cours, ${formatAmount(open.reduce((s, d) => s + d.estimated_amount, 0))} FCFA estimés, ${won.length} gagnée${won.length > 1 ? 's' : ''}`}
        actions={
          <>
            <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
              <Link href={viewHref('pipeline')} className={`px-2.5 py-1.5 text-[13px] ${view === 'pipeline' ? 'bg-kf-navy text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                Pipeline
              </Link>
              <span className="w-px bg-gray-300" />
              <Link href={viewHref('liste')} className={`px-2.5 py-1.5 text-[13px] ${view === 'liste' ? 'bg-kf-navy text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                Liste
              </Link>
            </div>
            <Link href="/affaires/new" className="btn-primary">
              <IconPlus className="h-4 w-4" /> Nouvelle affaire
            </Link>
          </>
        }
      />

      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {seesAll && commercials.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <Link href={href({ commercial: undefined })} className={pill(!params.commercial)}>
            Tous les commerciaux
          </Link>
          {commercials.map(([id, name]) => (
            <Link key={id} href={href({ commercial: id })} className={pill(params.commercial === id)}>
              {name}
            </Link>
          ))}
        </div>
      )}

      {view === 'pipeline' ? (
        deals.length === 0 ? (
          <div className="card">
            <EmptyState
              title="Aucune affaire pour l'instant"
              description="Une affaire suit une vente du premier contact jusqu'au paiement. Elle se crée aussi automatiquement avec une facture proforma."
              action={{ href: '/affaires/new', label: 'Ouvrir une affaire' }}
            />
          </div>
        ) : (
          <DealPipeline key={params.commercial ?? 'all'} deals={pipelineDeals} showOwner={seesAll} />
        )
      ) : (
      <>
      <div className="grid gap-3 grid-cols-3">
        {TEMPERATURES.map((t) => {
          const list = open.filter((d) => d.temperature === t.value);
          return (
            <Link
              key={t.value}
              href={href({ temp: params.temp === t.value ? undefined : t.value, etape: undefined })}
              className={`card card-hover p-3 sm:p-4 ${params.temp === t.value ? 'border-kf-navy' : ''}`}
            >
              <p className="flex items-center gap-2 text-xs text-gray-500">
                <span className={`inline-block h-2 w-2 rounded-sm ${t.dot}`} /> {t.label}s
              </p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{list.length}</p>
              <p className="num text-xs text-gray-500">{formatAmount(list.reduce((s, d) => s + d.estimated_amount, 0))} FCFA</p>
            </Link>
          );
        })}
      </div>

      <div className="space-y-3">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <Link href={href({ etape: undefined })} className={pill(etape === 'ouvertes')}>
            En cours
          </Link>
          {DEAL_STAGES.map((s) => (
            <Link key={s.value} href={href({ etape: s.value })} className={pill(etape === s.value)}>
              {s.label}
            </Link>
          ))}
          <Link href={href({ etape: 'toutes' })} className={pill(etape === 'toutes')}>
            Toutes
          </Link>
        </div>
      </div>

      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-500">Aucune affaire ne correspond à ces critères.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map((d) => {
              const t = temperature(d.temperature);
              const st = dealStage(d.stage);
              const late = d.expected_close_date && d.expected_close_date < today && OPEN_STAGES.includes(d.stage);
              return (
                <li key={d.id}>
                  <Link href={`/affaires/${d.id}`} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-gray-50">
                    <span className="min-w-0 flex gap-3">
                      <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-sm ${t.dot}`} title={t.label} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-900 truncate">{d.title}</span>
                        <span className="block text-xs text-gray-500 truncate">
                          {contactName(d)}
                          {d.product ? ` · ${d.product.designation}${d.quantity > 1 ? ` x${d.quantity}` : ''}` : ''}
                          {seesAll && d.owner?.full_name ? ` · ${d.owner.full_name}` : ''}
                        </span>
                        {d.expected_close_date && (
                          <span className={`block text-xs ${late ? 'text-red-600' : 'text-gray-400'}`}>
                            Conclusion prévue le {new Date(`${d.expected_close_date}T00:00:00`).toLocaleDateString('fr-FR')}
                            {late ? ' (dépassée)' : ''}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="num block text-sm font-medium text-gray-900">{formatAmount(d.estimated_amount)}</span>
                      <span className={`${st.badge} mt-1`}>{st.label}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      </>
      )}
    </div>
  );
}
