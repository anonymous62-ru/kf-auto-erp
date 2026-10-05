import { getWarranty } from '@/lib/garanties/actions';
import { ClaimManager } from '@/components/garanties/claim-manager';
import Link from 'next/link';
import { IconChevronRight } from '@/components/icons';

export default async function WarrantyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { warranty, claims, endDate } = await getWarranty(id);
  const client = warranty.clients as any;
  const clientName = client ? client.company_name || [client.first_name, client.last_name].filter(Boolean).join(' ') : null;
  const expired = endDate < new Date();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <Link href="/garanties" className="hover:text-kf-navy">
          Garanties constructeur
        </Link>
        <IconChevronRight className="w-3 h-3" />
        <span className="text-gray-600">{warranty.vehicle_vin}</span>
      </div>

      <div className="card p-4 space-y-1">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-medium">
            {[warranty.brand, warranty.model].filter(Boolean).join(' ') || 'Véhicule'}
          </h1>
          <span className={`badge ${expired ? 'badge-gray' : 'badge-green'}`}>{expired ? 'Expirée' : 'Active'}</span>
        </div>
        <p className="text-sm text-gray-600">{clientName || 'Aucun client associé'}</p>
        <p className="text-xs text-gray-500">VIN : {warranty.vehicle_vin}</p>
        <p className="text-xs text-gray-500">
          Du {new Date(warranty.start_date).toLocaleDateString('fr-FR')} au {endDate.toLocaleDateString('fr-FR')} — jusqu'à{' '}
          {Number(warranty.mileage_limit).toLocaleString('fr-FR')} km
        </p>
        {warranty.covered_parts && <p className="text-xs text-gray-500 pt-1">Couverture : {warranty.covered_parts}</p>}
      </div>

      <ClaimManager warrantyId={warranty.id} claims={claims} />
    </div>
  );
}
