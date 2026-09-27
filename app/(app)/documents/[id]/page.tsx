import { createClient } from '@/lib/supabase/server';
import { formatCFA } from '@/lib/documents/calculations';
import { notFound } from 'next/navigation';
import { SendActions } from '@/components/documents/send-actions';
import { PaymentForm } from '@/components/payments/payment-form';
import { getPayments } from '@/lib/payments/actions';
import { convertToFacture } from '@/lib/documents/actions';
import { DeleteDocumentButton } from '@/components/documents/delete-document-button';

const DOCUMENT_LABELS: Record<string, string> = {
  proforma: 'Proforma',
  devis: 'Devis',
  facture: 'Facture',
  bon_livraison: 'Bon de livraison',
  recu: 'Reçu',
  avoir: 'Avoir',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  especes: 'Espèces',
  virement: 'Virement',
  cheque: 'Chèque',
  mobile_money_flooz: 'Flooz',
  mobile_money_tmoney: 'TMoney',
  autre: 'Autre',
};

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: document } = await supabase
    .from('documents')
    .select(
      `id, document_type, document_number, status, subtotal, tax_amount, total_amount, amount_paid, balance_due,
       due_date, issue_date, commercial_signature_url, client_signature_url, client_id,
       clients (first_name, last_name, company_name, phone, email)`
    )
    .eq('id', id)
    .single();

  if (!document) notFound();

  const { data: items } = await supabase
    .from('document_items')
    .select('id, designation, quantity, unit_price, tax_rate, line_total')
    .eq('document_id', id)
    .order('position');

  const payments = await getPayments(id);

  const client = Array.isArray(document.clients) ? document.clients[0] : document.clients;
  const balanceDue = Number(document.balance_due);
  const isFactureOuRecu = document.document_type === 'facture' || document.document_type === 'recu';
  const canConvertToFacture =
    ['devis', 'proforma'].includes(document.document_type) && document.status !== 'accepte' && document.status !== 'annule';

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border p-4">
        <p className="text-xs text-gray-500">{DOCUMENT_LABELS[document.document_type]}</p>
        <h1 className="text-lg font-medium">{document.document_number ?? '(en attente de synchronisation)'}</h1>
        <p className="text-sm text-gray-600 mt-1">
          {client?.company_name || `${client?.first_name ?? ''} ${client?.last_name ?? ''}`}
        </p>
        <p className="text-xs text-gray-400 mt-1">Statut : {document.status}</p>
      </div>

      <div className="bg-white rounded-lg border divide-y">
        {items?.map((item) => (
          <div key={item.id} className="flex justify-between p-3 text-sm">
            <div>
              <p className="font-medium">{item.designation}</p>
              <p className="text-xs text-gray-500">
                {Number(item.quantity)} x {formatCFA(Number(item.unit_price))}
              </p>
            </div>
            <p className="font-medium">{formatCFA(Number(item.line_total))}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border p-3 text-sm space-y-1">
        <div className="flex justify-between text-gray-600">
          <span>Sous-total</span>
          <span>{formatCFA(Number(document.subtotal))}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>TVA</span>
          <span>{formatCFA(Number(document.tax_amount))}</span>
        </div>
        <div className="flex justify-between font-medium border-t pt-1">
          <span>Total TTC</span>
          <span>{formatCFA(Number(document.total_amount))}</span>
        </div>
      </div>

      {document.client_signature_url ? (
        <div className="bg-white rounded-lg border p-3 grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-gray-500 mb-1">Signature commerciale</p>
            {document.commercial_signature_url && (
              <img src={document.commercial_signature_url} alt="Signature commerciale" className="border rounded-md" />
            )}
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Signature client</p>
            <img src={document.client_signature_url} alt="Signature client" className="border rounded-md" />
          </div>
        </div>
      ) : (
        <a
          href={`/documents/${document.id}/sign`}
          className="block text-center bg-kf-navy text-white rounded-md py-3 text-sm font-medium"
        >
          Faire signer
        </a>
      )}

      <div className="grid grid-cols-2 gap-2">
        <a
          href={`/api/documents/${document.id}/pdf`}
          target="_blank"
          className="block text-center border border-kf-navy text-kf-navy rounded-md py-3 text-sm font-medium"
        >
          PDF
        </a>
        <a
          href={`/api/documents/${document.id}/docx`}
          className="block text-center border border-kf-navy text-kf-navy rounded-md py-3 text-sm font-medium"
        >
          Word (.docx)
        </a>
      </div>

      {canConvertToFacture && (
        <form action={convertToFacture.bind(null, document.id)}>
          <button
            type="submit"
            className="w-full bg-kf-orange text-white rounded-md py-3 text-sm font-medium"
          >
            Convertir en facture
          </button>
        </form>
      )}

      <SendActions
        documentId={document.id}
        documentNumber={document.document_number}
        clientPhone={client?.phone}
        clientEmail={client?.email}
      />

      {isFactureOuRecu && (
        <div className="bg-white rounded-lg border p-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Payé</span>
            <span>{formatCFA(Number(document.amount_paid))}</span>
          </div>
          <div className="flex justify-between text-sm font-medium">
            <span>Solde restant</span>
            <span className={balanceDue > 0 ? 'text-red-600' : 'text-green-600'}>{formatCFA(balanceDue)}</span>
          </div>
          {payments.length > 0 && (
            <div className="border-t pt-2 space-y-1">
              {payments.map((p) => (
                <div key={p.id} className="flex justify-between text-xs text-gray-500">
                  <span>
                    {PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method} - {p.payment_date}
                  </span>
                  <span>{formatCFA(Number(p.amount))}</span>
                </div>
              ))}
            </div>
          )}
          {balanceDue > 0 && (
            <PaymentForm
              documentId={document.id}
              documentNumber={document.document_number}
              clientId={document.client_id}
              balanceDue={balanceDue}
              clientPhone={client?.phone}
              clientEmail={client?.email}
            />
          )}
        </div>
      )}

      <DeleteDocumentButton documentId={document.id} documentNumber={document.document_number} />
    </div>
  );
}
