import { getWarranties } from '@/lib/garanties/actions';
import Link from 'next/link';
import { IconPlus } from '@/components/icons';
import { can, getCurrentRole } from '@/lib/permissions';

function clientName(c: any) {
  if (!c) return 'Client non renseigné';
  return c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Client';
}

export default async function WarrantiesPage() {
  const role = await getCurrentRole();
  const warranties = await getWarranties();
  const now = new Date();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Garanties constructeur</h1>
        {can(role, 'warrantyWrite') && (
          <Link href="/garanties/new" className="btn-primary text-sm px-3 py-1.5">
            <IconPlus className="w-3.5 h-3.5" /> Nouvelle garantie
          </Link>
        )}
      </div>

      {warranties.length === 0 && (
        <div className="card p-4 text-sm text-gray-500">
          Aucune garantie enregistrée. Ajoutez une garantie par véhicule vendu (VIN, durée, kilométrage couvert).
        </div>
      )}

      <div className="space-y-2">
        {warranties.map((w: any) => {
          const expired = w.endDate < now;
          return (
            <Link key={w.id} href={`/garanties/${w.id}`} className="card card-hover p-3 text-sm flex justify-between items-center gap-3">
              <div className="min-w-0">
                <p className="font-medium truncate">
                  {[w.brand, w.model].filter(Boolean).join(' ') || 'Véhicule'} — VIN {w.vehicle_vin}
                </p>
                <p className="text-xs text-gray-500">{clientName(w.clients)}</p>
              </div>
              <div className="text-right whitespace-nowrap">
                <span className={`badge ${expired ? 'badge-gray' : 'badge-green'}`}>
                  {expired ? 'Expirée' : 'Active'}
                </span>
                <p className="text-xs text-gray-500 mt-1">jusqu'au {w.endDate.toLocaleDateString('fr-FR')}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
