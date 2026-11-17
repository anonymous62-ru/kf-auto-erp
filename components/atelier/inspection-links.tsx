// Carte "Réception / restitution" affichée sur l'ordre de réparation.
import Link from 'next/link';
import { IconClipboard } from '@/components/icons';
import type { InspectionRow } from '@/lib/atelier/inspection-config';

function state(row: InspectionRow | null) {
  if (!row) return { label: 'Non remplie', cls: 'badge-gray' };
  if (!row.client_signed_at) return { label: 'Brouillon', cls: 'badge-amber' };
  return {
    label: `Signée le ${new Date(row.client_signed_at).toLocaleDateString('fr-FR', { timeZone: 'Africa/Lome' })}`,
    cls: 'badge-green',
  };
}

export function InspectionLinks({
  repairOrderId,
  reception,
  restitution,
}: {
  repairOrderId: string;
  reception: InspectionRow | null;
  restitution: InspectionRow | null;
}) {
  const rec = state(reception);
  const res = state(restitution);
  const restitutionOpen = !!reception?.client_signed_at;

  return (
    <div className="card p-4 space-y-3">
      <h2 className="text-sm font-semibold text-kf-navy">État du véhicule (réception et restitution)</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        <Link href={`/atelier/${repairOrderId}/inspection/reception`} className="btn-secondary h-auto min-h-12 justify-between py-2">
          <span className="inline-flex items-center gap-2">
            <IconClipboard className="w-4 h-4" /> Fiche de réception
          </span>
          <span className={rec.cls}>{rec.label}</span>
        </Link>
        {restitutionOpen ? (
          <Link href={`/atelier/${repairOrderId}/inspection/restitution`} className="btn-secondary h-auto min-h-12 justify-between py-2">
            <span className="inline-flex items-center gap-2">
              <IconClipboard className="w-4 h-4" /> Fiche de restitution
            </span>
            <span className={res.cls}>{res.label}</span>
          </Link>
        ) : (
          <span
            className="btn-secondary h-auto min-h-12 justify-between py-2 opacity-60 cursor-not-allowed"
            aria-disabled="true"
            title="Disponible après la signature de la fiche de réception"
          >
            <span className="inline-flex items-center gap-2">
              <IconClipboard className="w-4 h-4" /> Fiche de restitution
            </span>
            <span className="text-xs text-encre-3 whitespace-normal">Après la réception signée</span>
          </span>
        )}
      </div>
    </div>
  );
}
