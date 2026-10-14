import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
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
        <h1 className="page-title">Contrats de vente</h1>
        <Link href="/contracts/new" className="btn-primary">
          Nouveau
        </Link>
      </div>

      {contracts.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Aucun contrat de vente"
            description="Le contrat se prépare à partir d'un véhicule du catalogue et d'un client, puis se signe sur la tablette."
            action={{ href: '/contracts/new', label: 'Préparer un contrat' }}
          />
        </div>
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
                  <p className="text-xs text-gray-500">{clientName} · {vehicleLabel}</p>
                  <p className="text-xs text-gray-400">{formatCFA(Number(c.sale_price))}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-md ${STATUS_CLASSES[c.status] ?? ''}`}>
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
