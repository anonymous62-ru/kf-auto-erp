import { getUnpaidDocuments } from '@/lib/payments/actions';
import { formatCFA } from '@/lib/documents/calculations';
import { RelanceButton } from '@/components/payments/relance-button';
import Link from 'next/link';

function daysLate(dueDate: string | null): number | null {
  if (!dueDate) return null;
  const diff = Date.now() - new Date(dueDate).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export default async function ImpayesPage() {
  const documents = await getUnpaidDocuments();

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-medium">Impayés</h1>
      {documents.length === 0 && <p className="text-sm text-gray-500">Aucun impayé pour le moment.</p>}
      {documents.map((doc) => {
        const client = Array.isArray(doc.clients) ? doc.clients[0] : doc.clients;
        const late = daysLate(doc.due_date);
        const color = late === null ? 'text-gray-500' : late > 0 ? 'text-red-600' : late > -7 ? 'text-amber-600' : 'text-green-600';
        return (
          <Link
            key={doc.id}
            href={`/documents/${doc.id}`}
            className="block bg-white rounded-lg border p-3 text-sm"
          >
            <div className="flex justify-between">
              <p className="font-medium">{doc.document_number ?? doc.id.slice(0, 8)}</p>
              <p className="font-medium text-red-600">{formatCFA(Number(doc.balance_due))}</p>
            </div>
            <p className="text-xs text-gray-500">
              {client?.company_name || `${client?.first_name ?? ''} ${client?.last_name ?? ''}`}
            </p>
            <p className={`text-xs mt-1 ${color}`}>
              {late === null
                ? 'Pas d\'échéance définie'
                : late > 0
                ? `En retard de ${late} jour(s)`
                : `Échéance dans ${Math.abs(late)} jour(s)`}
            </p>
            {late !== null && late > 0 && (
              <RelanceButton
                documentId={doc.id}
                documentNumber={doc.document_number}
                balanceDue={Number(doc.balance_due)}
                clientPhone={client?.phone}
                clientEmail={client?.email}
              />
            )}
          </Link>
        );
      })}
    </div>
  );
}
