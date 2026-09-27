import Link from 'next/link';
import { getSaleContracts } from '@/lib/contracts/actions';
import { formatCFA } from '@/lib/documents/calculations';

const STATUS_LABELS: Record<string, string> = {
  brouillon: 'Brouillon',
  signe: 'Signé',
  annule: 'Annulé',
};

const STATUS_CLASSES: Record<string, string> = {
  brouillon: 'bg-gray-100 text-gray-500',
  signe: 'bg-green-100 text-green-700',
  annule: 'bg-red-100 text-red-600',
};

export default async function ContractsPage() {
  const contracts = await getSaleContracts();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Contrats de vente</h1>
        <Link href="/contracts/new" className="text-sm bg-kf-navy text-white rounded-md px-3 py-1.5">
          + Nouveau
        </Link>
      </div>

      {contracts.length === 0 ? (
        <p className="text-sm text-gray-400">Aucun contrat pour l'instant.</p>
      ) : (
        <div className="space-y-2">
          {contracts.map((c) => {
            const client = Array.isArray(c.clients) ? c.clients[0] : c.clients;
            const product = Array.isArray(c.products) ? c.products[0] : c.products;
            const clientName = client?.company_name || `${client?.first_name ?? ''} ${client?.last_name ?? ''}`.trim();
            const vehicleLabel = [product?.brand, product?.model].filter(Boolean).join(' ') || product?.designation;
            return (
              <Link key={c.id} href={`/contracts/${c.id}`} className="card p-3 flex items-center justify-between block">
                <div>
                  <p className="text-sm font-medium">{c.contract_number ?? '(en attente)'}</p>
                  <p className="text-xs text-gray-500">{clientName} — {vehicleLabel}</p>
                  <p className="text-xs text-gray-400">{formatCFA(Number(c.sale_price))}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${STATUS_CLASSES[c.status] ?? ''}`}>
                  {STATUS_LABELS[c.status] ?? c.status}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
