import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listVehicleUnits } from '@/lib/stock/actions';
import { ageLabel, ageTone, daysInStock, vehicleStatus } from '@/lib/stock/labels';
import { documentTypeLabel } from '@/lib/documents/labels';
import { can, getCurrentRole } from '@/lib/permissions';
import { DIRECTION_ROLES } from '@/lib/users/roles';
import { VehicleUnitEditor } from '@/components/stock/vehicle-unit-editor';

export default async function VehicleUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const role = await getCurrentRole();
  const { units } = await listVehicleUnits();
  const unit = units.find((u) => u.id === id);
  if (!unit) notFound();

  const st = vehicleStatus(unit.status);
  const days = daysInStock(unit.entry_date, unit.status === 'vendu' ? unit.sold_at : null);

  return (
    <div className="space-y-4 max-w-2xl">
      <Link href="/stock" className="text-sm text-gray-500 hover:text-kf-navy">
        ← Stock véhicules
      </Link>
      <div className="card p-4">
        <p className="text-xs text-gray-500">{unit.model}</p>
        <h1 className="font-mono text-lg font-semibold text-gray-900">{unit.vin}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className={st.badge}>{st.label}</span>
          <span className={ageTone(days)}>
            {unit.status === 'vendu' ? `vendu après ${days} jours de stock` : `en stock ${ageLabel(days)}`}
          </span>
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Entré le {new Date(`${unit.entry_date}T00:00:00`).toLocaleDateString('fr-FR')}
          {unit.color ? ` · ${unit.color}` : ''}
          {unit.model_year ? ` · ${unit.model_year}` : ''}
          {unit.location ? ` · ${unit.location}` : ''}
        </p>
        {unit.document_number && (
          <p className="mt-2 text-sm text-gray-700">
            {unit.status === 'vendu' ? 'Vendu sur' : 'Attribué à'} {documentTypeLabel(unit.document_type ?? '').toLowerCase()}{' '}
            <Link href={`/documents/${unit.document_id}`} className="font-medium text-kf-navy hover:underline">
              {unit.document_number}
            </Link>
            {unit.commercial_name ? ` (${unit.commercial_name})` : ''}
          </p>
        )}
        {unit.notes && <p className="mt-2 border-t pt-2 text-xs text-gray-600">{unit.notes}</p>}
      </div>
      {can(role, 'vehicleUnitWrite') && (
        <VehicleUnitEditor
          unit={{
            id: unit.id,
            vin: unit.vin,
            color: unit.color,
            model_year: unit.model_year,
            entry_date: unit.entry_date,
            location: unit.location,
            notes: unit.notes,
            status: unit.status,
          }}
          isDirection={DIRECTION_ROLES.includes(role ?? '')}
        />
      )}
    </div>
  );
}
