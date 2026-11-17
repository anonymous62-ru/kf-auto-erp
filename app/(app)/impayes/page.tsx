import Link from 'next/link';
import { getOpenInstallments, getUnpaidDocuments } from '@/lib/payments/actions';
import {
  INSTALLMENT_STATUS_BADGE,
  INSTALLMENT_STATUS_LABEL,
  displayStatus,
  formatDateFR,
  formatFCFA,
  todayISO,
} from '@/lib/payments/schedule';
import { formatCFA } from '@/lib/documents/calculations';
import { RelanceButton } from '@/components/payments/relance-button';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';

function daysLate(dueDate: string | null): number | null {
  if (!dueDate) return null;
  const diff = Date.now() - new Date(dueDate).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// Filtre de la section Échéances (paramètre ?echeances=).
const INSTALLMENT_FILTERS = [
  { key: 'toutes', label: 'Toutes' },
  { key: 'retard', label: 'En retard' },
  { key: 'semaine', label: 'Cette semaine' },
  { key: 'a_venir', label: 'À venir' },
] as const;
type InstallmentFilter = (typeof INSTALLMENT_FILTERS)[number]['key'];

function plusDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default async function ImpayesPage({
  searchParams,
}: {
  searchParams: Promise<{ echeances?: string }>;
}) {
  const { echeances } = await searchParams;
  const filter: InstallmentFilter = INSTALLMENT_FILTERS.some((f) => f.key === echeances)
    ? (echeances as InstallmentFilter)
    : 'toutes';
  const [documents, openInstallments] = await Promise.all([getUnpaidDocuments(), getOpenInstallments()]);
  const balanceByDoc = new Map(documents.map((d) => [d.id, Number(d.balance_due)]));
  const today = todayISO();
  const weekEnd = plusDays(today, 7);
  const installments = openInstallments
    .map((i) => ({ ...i, shown: displayStatus(i.status, i.due_date) }))
    .filter((i) => {
      if (filter === 'retard') return i.shown === 'en_retard';
      if (filter === 'semaine') return i.shown !== 'en_retard' && i.due_date <= weekEnd;
      if (filter === 'a_venir') return i.shown === 'a_venir';
      return true;
    });
  const lateCount = openInstallments.filter((i) => displayStatus(i.status, i.due_date) === 'en_retard').length;
  const total = documents.reduce((s, d) => s + Number(d.balance_due), 0);
  const overdue = documents.filter((d) => (daysLate(d.due_date) ?? 0) > 0);
  const rows = [...documents].sort((a, b) => (daysLate(b.due_date) ?? -9999) - (daysLate(a.due_date) ?? -9999));

  return (
    <div>
      <PageHeader
        title="Impayés"
        description={
          documents.length
            ? `${formatCFA(total)} restant dû sur ${documents.length} document${documents.length > 1 ? 's' : ''}, dont ${overdue.length} en retard`
            : 'Factures émises avec un solde restant dû'
        }
      />
      <div className="table-wrap">
        {rows.length === 0 ? (
          <EmptyState title="Aucun impayé" description="Toutes les factures émises sont soldées." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Document</th>
                <th className="hidden md:table-cell">Client</th>
                <th>Échéance</th>
                <th className="num">Reste dû</th>
                <th className="hidden sm:table-cell" />
              </tr>
            </thead>
            <tbody>
              {rows.map((doc) => {
                const client = Array.isArray(doc.clients) ? doc.clients[0] : doc.clients;
                const name = client?.company_name || `${client?.first_name ?? ''} ${client?.last_name ?? ''}`.trim();
                const late = daysLate(doc.due_date);
                return (
                  <tr key={doc.id}>
                    <td>
                      <Link href={`/documents/${doc.id}`} className="font-medium hover:text-kf-navy">
                        {doc.document_number ?? doc.id.slice(0, 8)}
                      </Link>
                      <span className="block text-xs text-gray-500 md:hidden">{name}</span>
                    </td>
                    <td className="hidden text-gray-700 md:table-cell">{name}</td>
                    <td className="whitespace-nowrap">
                      {late === null ? (
                        <span className="text-gray-500">Non définie</span>
                      ) : late > 0 ? (
                        <span className="badge-red">En retard de {late} j</span>
                      ) : (
                        <span className="text-gray-600">Dans {Math.abs(late)} j</span>
                      )}
                    </td>
                    <td className="num whitespace-nowrap font-medium">{formatCFA(Number(doc.balance_due))}</td>
                    <td className="hidden text-right sm:table-cell">
                      {late !== null && late > 0 && (
                        <RelanceButton
                          documentId={doc.id}
                          documentNumber={doc.document_number}
                          balanceDue={Number(doc.balance_due)}
                          clientPhone={client?.phone}
                          clientEmail={client?.email}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <section className="mt-8 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            Échéances
            {lateCount > 0 && <span className="badge-red ml-2">{lateCount} en retard</span>}
          </h2>
          <nav className="flex flex-wrap gap-1" aria-label="Filtrer les échéances">
            {INSTALLMENT_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={f.key === 'toutes' ? '/impayes' : `/impayes?echeances=${f.key}`}
                scroll={false}
                className={`rounded-md border px-2.5 py-1 text-xs ${
                  filter === f.key ? 'border-kf-navy bg-kf-navy text-white' : 'border-gray-200 text-gray-700'
                }`}
              >
                {f.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="table-wrap">
          {installments.length === 0 ? (
            <EmptyState
              compact
              title="Aucune échéance"
              description="Les échéanciers se créent à l'enregistrement d'un acompte sur une facture."
            />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Facture</th>
                  <th className="hidden md:table-cell">Client</th>
                  <th>Date</th>
                  <th className="num">Montant</th>
                  <th>Statut</th>
                  <th className="hidden sm:table-cell" />
                </tr>
              </thead>
              <tbody>
                {installments.map((i) => {
                  const name =
                    i.client?.company_name || `${i.client?.first_name ?? ''} ${i.client?.last_name ?? ''}`.trim();
                  const due = i.amount - i.paid_amount;
                  return (
                    <tr key={i.id}>
                      <td>
                        <Link href={`/documents/${i.document_id}?onglet=paiements`} className="font-medium hover:text-kf-navy">
                          {i.document_number ?? i.document_id.slice(0, 8)}
                        </Link>
                        <span className="block text-xs text-gray-500">Échéance n° {i.seq}</span>
                        <span className="block text-xs text-gray-500 md:hidden">{name}</span>
                      </td>
                      <td className="hidden text-gray-700 md:table-cell">{name}</td>
                      <td className="whitespace-nowrap tabular-nums">{formatDateFR(i.due_date)}</td>
                      <td className="num whitespace-nowrap font-medium">{formatFCFA(due)}</td>
                      <td>
                        <span className={INSTALLMENT_STATUS_BADGE[i.shown]}>{INSTALLMENT_STATUS_LABEL[i.shown]}</span>
                      </td>
                      <td className="hidden text-right sm:table-cell">
                        <RelanceButton
                          documentId={i.document_id}
                          documentNumber={i.document_number}
                          balanceDue={balanceByDoc.get(i.document_id) ?? due}
                          clientPhone={i.client?.phone}
                          clientEmail={i.client?.email}
                          installment={{ seq: i.seq, amount: due, dueDate: i.due_date, overdue: i.shown === 'en_retard' }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
