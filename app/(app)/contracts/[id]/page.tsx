import { notFound } from 'next/navigation';
import { getSaleContract } from '@/lib/contracts/actions';
import { formatCFA } from '@/lib/documents/calculations';
import { CancelContractButton } from '@/components/contracts/cancel-contract-button';

const STATUS_LABELS: Record<string, string> = {
  brouillon: 'Brouillon',
  signe: 'Signé',
  annule: 'Annulé',
};

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let contract;
  try {
    contract = await getSaleContract(id);
  } catch {
    notFound();
  }
  if (!contract) notFound();

  const client = Array.isArray(contract.clients) ? contract.clients[0] : contract.clients;
  const product = Array.isArray(contract.products) ? contract.products[0] : contract.products;
  const commercial = Array.isArray(contract.profiles) ? contract.profiles[0] : contract.profiles;
  const clientName = client?.company_name || `${client?.first_name ?? ''} ${client?.last_name ?? ''}`.trim();
  const vehicleLabel = [product?.brand, product?.model].filter(Boolean).join(' ') || product?.designation;
  const bothSigned = Boolean(contract.commercial_signature_url && contract.client_signature_url);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <p className="text-xs text-gray-500">Contrat de vente</p>
        <h1 className="text-lg font-medium">{contract.contract_number ?? '(en attente)'}</h1>
        <p className="text-sm text-gray-600 mt-1">{clientName}</p>
        <p className="text-xs text-gray-400">{vehicleLabel}</p>
        <p className="text-xs text-gray-400 mt-1">
          Statut : {STATUS_LABELS[contract.status] ?? contract.status}
          {commercial?.full_name ? ` — Vendeur : ${commercial.full_name}` : ''}
        </p>
      </div>

      <div className="card p-4 text-sm space-y-1">
        <div className="flex justify-between">
          <span className="text-gray-500">Prix de vente</span>
          <span className="font-medium">{formatCFA(Number(contract.sale_price))}</span>
        </div>
        {contract.payment_terms && (
          <div className="border-t pt-2">
            <p className="text-xs text-gray-500 mb-1">Modalités de paiement</p>
            <p className="text-sm whitespace-pre-wrap">{contract.payment_terms}</p>
          </div>
        )}
        {contract.notes && (
          <div className="border-t pt-2">
            <p className="text-xs text-gray-500 mb-1">Conditions particulières</p>
            <p className="text-sm whitespace-pre-wrap">{contract.notes}</p>
          </div>
        )}
      </div>

      {bothSigned ? (
        <div className="card p-4 grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-gray-500 mb-1">Signature du vendeur</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={contract.commercial_signature_url!} alt="Signature du vendeur" className="border rounded-md" />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Signature de l'acheteur</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={contract.client_signature_url!} alt="Signature de l'acheteur" className="border rounded-md" />
          </div>
        </div>
      ) : (
        contract.status !== 'annule' && (
          <a
            href={`/contracts/${contract.id}/sign`}
            className="block text-center bg-kf-navy text-white rounded-md py-3 text-sm font-medium"
          >
            Faire signer le contrat
          </a>
        )
      )}

      <a
        href={`/api/contracts/${contract.id}/pdf`}
        target="_blank"
        className="block text-center border border-kf-navy text-kf-navy rounded-md py-2.5 text-sm font-medium"
      >
        Voir le contrat (PDF)
      </a>

      {contract.status !== 'annule' && <CancelContractButton contractId={contract.id} />}
    </div>
  );
}
