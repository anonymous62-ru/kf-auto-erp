import Link from 'next/link';
import { PendingDocumentsWidget } from '@/components/offline/pending-documents-widget';
import { MfaNudgeBanner } from '@/components/security/mfa-nudge-banner';
import { TargetGauge, millions } from '@/components/dashboard/gauge';
import { Fleet } from '@/components/dashboard/fleet';
import { cockpitSummary, loadCockpit } from '@/lib/dashboard/cockpit';

// Tableau de bord « cockpit » (maquette du 13/10/2026), branché sur les
// vraies données : aucun chiffre n'est inventé.

function variation(current: number, previous: number) {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <span className={value >= 0 ? 'text-[#4FD994]' : 'text-[#FF8D91]'}>
      {value > 0 ? '+' : ''}
      {value} %
    </span>
  );
}

function Readout({
  label,
  value,
  unit,
  note,
  alert = false,
  href,
}: {
  label: string;
  value: string;
  unit?: string;
  note: React.ReactNode;
  alert?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <span className="text-[12.5px] text-acier">{label}</span>
      <b className={`num text-right font-display text-[22px] font-bold tracking-[-0.02em] ${alert ? 'text-[#FF7479]' : ''}`}>
        {value}
        {unit && <small className="ml-[3px] text-xs font-medium text-acier">{unit}</small>}
      </b>
      <em className="col-span-2 text-xs not-italic text-[#93A3B9]">{note}</em>
    </>
  );
  const cls =
    'grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1 rounded-lg border border-nuit-3 bg-nuit-2 px-3.5 py-3';
  return href ? (
    <Link href={href} className={`${cls} hover:border-acier-2`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

const STEPS = ['Proforma', 'Commande', 'Facture', 'Payé'];

export default async function DashboardPage() {
  const d = await loadCockpit();
  const collectedDelta = variation(d.collected, d.collectedPrev);
  const leadsDelta = variation(d.leadsMonth, d.leadsPrev);
  const TONE: Record<string, string> = { r: 'text-rouge', a: 'text-[#A6620A]', n: 'text-encre', g: 'text-encre-3' };

  return (
    <>
      {/* Bandeau bleu nuit, filet rouge en bas */}
      <section className="relative overflow-hidden bg-nuit text-white after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-rouge">
        <div className="grid items-center justify-items-center gap-7 px-4 pb-7 pt-5 md:grid-cols-[1fr_auto] md:justify-items-stretch lg:px-8 lg:pb-[34px] lg:pt-[26px] xl:grid-cols-[1fr_auto_1fr]">
          <div className="justify-self-stretch">
            <small className="text-[13px] text-acier">{d.dateLabel}</small>
            <h1 className="mb-3.5 mt-1 font-display text-[30px] font-bold tracking-[-0.02em]">
              Bonjour{d.firstName ? ` ${d.firstName}` : ''}
            </h1>
            <p className="max-w-[34ch] text-sm leading-normal text-[#C3CEDD]">{cockpitSummary(d)}</p>
            <div className="mt-[18px] flex flex-wrap gap-2">
              {d.commercialSide ? (
                <>
                  <Link href="/documents/new/devis" className="btn-accent">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                    </svg>
                    Nouvelle proforma
                  </Link>
                  <Link href="/prospects/new" className="btn border-nuit-3 bg-transparent text-white hover:bg-nuit-2">
                    Ajouter un lead
                  </Link>
                </>
              ) : (
                <Link href="/atelier/new" className="btn-accent">
                  Ordre de réparation
                </Link>
              )}
              {d.canSetTarget && d.target === 0 && (
                <Link href="/settings/organisation" className="btn border-nuit-3 bg-transparent text-white hover:bg-nuit-2">
                  Fixer l&apos;objectif
                </Link>
              )}
            </div>
          </div>

          <TargetGauge invoiced={d.invoiced} target={d.target} monthName={d.monthName} />

          <div className="grid w-full gap-2.5 md:col-span-2 md:grid-cols-3 xl:col-span-1 xl:max-w-[330px] xl:grid-cols-1 xl:justify-self-end">
            <Readout
              label="Encaissé ce mois"
              value={millions(d.collected)}
              unit="M FCFA"
              note={
                collectedDelta !== null ? (
                  <>
                    <Delta value={collectedDelta} /> par rapport à {d.prevMonthName}, même période
                  </>
                ) : (
                  `Aucun encaissement en ${d.prevMonthName} à la même date`
                )
              }
            />
            <Readout
              label="Reste à encaisser"
              value={millions(d.unpaidTotal)}
              unit="M FCFA"
              alert={d.overdueCount > 0}
              href="/impayes"
              note={
                d.unpaidCount === 0
                  ? 'Aucune facture en attente'
                  : `${d.unpaidCount} facture${d.unpaidCount > 1 ? 's' : ''}${
                      d.overdueCount > 0
                        ? `, dont ${d.overdueCount} en retard${d.overdueCount === 1 ? ` de ${d.oldestOverdueDays} jours` : ` (jusqu'à ${d.oldestOverdueDays} jours)`}`
                        : ', aucune en retard'
                    }`
              }
            />
            <Readout
              label="Leads ce mois"
              value={String(d.leadsMonth)}
              href="/prospects"
              note={
                <>
                  {leadsDelta !== null && (
                    <>
                      <Delta value={leadsDelta} />{' '}
                    </>
                  )}
                  {d.hotDeals} affaire{d.hotDeals > 1 ? 's' : ''} chaude{d.hotDeals > 1 ? 's' : ''} en cours
                </>
              }
            />
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-[22px] px-4 pb-11 pt-5 lg:px-8 lg:pt-7">
        {d.role && <MfaNudgeBanner role={d.role} />}
        {d.commercialSide && <PendingDocumentsWidget />}

        <Fleet vehicles={d.fleet} />

        <div className="grid gap-[22px] grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <section className="card overflow-hidden" aria-labelledby="todo-t">
            <div className="px-4 pb-1 pt-4">
              <h2 id="todo-t" className="font-display text-[19px] font-bold tracking-[-0.01em]">
                À faire aujourd&apos;hui
              </h2>
            </div>
            {d.todo.length === 0 ? (
              <p className="px-4 pb-6 pt-3 text-[13px] text-encre-3">Rien d&apos;urgent : aucune relance, commande ou facture en attente.</p>
            ) : (
              <div>
                {d.todo.map((t, i) => (
                  <Link
                    key={t.key}
                    href={t.href}
                    className={`flex items-center gap-3.5 px-4 py-[13px] hover:bg-[#FAFBFC] ${i > 0 ? 'border-t border-trait-2' : ''}`}
                  >
                    <span className={`num w-[46px] shrink-0 text-right font-display text-[22px] font-bold tracking-[-0.02em] ${TONE[t.tone]}`}>
                      {t.count}
                    </span>
                    <span className="min-w-0">
                      <b className="block font-medium">{t.title}</b>
                      <span className="block truncate text-[12.5px] text-encre-3">{t.detail}</span>
                    </span>
                    <svg viewBox="0 0 24 24" className="ml-auto h-4 w-4 shrink-0" fill="none" stroke="#B6BECA" strokeWidth="2" aria-hidden="true">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="card overflow-x-auto" aria-labelledby="ventes-t">
            <div className="flex items-end gap-3 px-4 pb-1 pt-4">
              <h2 id="ventes-t" className="font-display text-[19px] font-bold tracking-[-0.01em]">
                Ventes en cours
              </h2>
              <Link href="/documents" className="ml-auto text-[13px] font-medium text-[#2357A6] hover:underline">
                Tout voir
              </Link>
            </div>
            {d.sales.length === 0 ? (
              <p className="px-4 pb-6 pt-3 text-[13px] text-encre-3">
                Aucune vente en cours ces 30 derniers jours.{' '}
                {d.commercialSide && (
                  <Link href="/documents/new/devis" className="font-medium text-[#2357A6] hover:underline">
                    Créer une proforma
                  </Link>
                )}
              </p>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="border-b border-trait px-3 py-[11px] text-left text-xs font-medium text-encre-3 md:px-4">Client</th>
                    <th className="hidden border-b border-trait px-4 py-[11px] text-left text-xs font-medium text-encre-3 md:table-cell">
                      Commercial
                    </th>
                    <th className="border-b border-trait px-3 py-[11px] text-left text-xs font-medium text-encre-3 md:px-4">Étape</th>
                    <th className="border-b border-trait px-3 py-[11px] text-right text-xs font-medium text-encre-3 md:px-4">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {d.sales.map((s, i) => (
                    <tr key={s.id} className="hover:bg-[#FAFBFC]">
                      <td className={`whitespace-nowrap px-3 py-3 md:px-4 ${i > 0 ? 'border-t border-trait-2' : ''}`}>
                        <Link href={s.href} className="hover:text-[#2357A6]">
                          {s.client}
                        </Link>
                        {s.vehicle && <div className="text-[13px] text-encre-2">{s.vehicle}</div>}
                      </td>
                      <td className={`hidden whitespace-nowrap px-4 py-3 md:table-cell ${i > 0 ? 'border-t border-trait-2' : ''}`}>
                        {s.commercial ?? ''}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-3 md:px-4 ${i > 0 ? 'border-t border-trait-2' : ''}`}>
                        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-1" aria-label={`Étape : ${s.label}`}>
                          <span className="flex gap-1" aria-hidden="true">
                          {STEPS.map((step, k) => (
                            <i
                              key={step}
                              className={`block h-1 w-[14px] rounded-sm sm:w-[18px] ${
                                k === s.stage && s.late ? 'bg-rouge' : k <= s.stage ? 'bg-nuit' : 'bg-trait'
                              }`}
                            />
                          ))}
                          </span>
                          <span className={`text-[12.5px] sm:ml-1.5 ${s.late ? 'font-medium text-rouge' : 'text-encre-2'}`}>{s.label}</span>
                        </div>
                      </td>
                      <td className={`num whitespace-nowrap px-3 py-3 text-right md:px-4 ${i > 0 ? 'border-t border-trait-2' : ''}`}>
                        {new Intl.NumberFormat('fr-FR').format(s.amount).replace(/[  ]/g, ' ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
