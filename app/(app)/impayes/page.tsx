import Link from 'next/link';
import { getUnpaidDocuments } from '@/lib/payments/actions';
import { formatCFA } from '@/lib/documents/calculations';
import { RelanceButton } from '@/components/payments/relance-button';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';

function daysLate(dueDate: string | null): number | null {
  if (!dueDate) return null;
  const diff = Date.now() - new Date(dueDate).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export default async function ImpayesPage() {
  const documents = await getUnpaidDocuments();
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
    </div>
  );
}
