import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IconChevronRight } from '@/components/icons';
import { getInspectionContext, getInspections, signInspectionFiles } from '@/lib/atelier/inspection-actions';
import {
  INSPECTION_KIND_LABELS,
  INSPECTION_WRITE_ROLES,
  isInspectionKind,
  type InspectionRow,
} from '@/lib/atelier/inspection-config';
import { InspectionForm } from '@/components/atelier/inspection-form';
import { InspectionView } from '@/components/atelier/inspection-view';
import { InspectionComparison } from '@/components/atelier/inspection-comparison';
import { PrintButton } from '@/components/atelier/print-button';

export const dynamic = 'force-dynamic';

function filesOf(...rows: (InspectionRow | null)[]) {
  return rows.flatMap((r) => (r ? [...r.photos, ...(r.client_signature_url ? [r.client_signature_url] : [])] : []));
}

export default async function InspectionPage({ params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params;
  if (!isInspectionKind(kind)) notFound();

  const [{ order, userName, role }, { reception, restitution }] = await Promise.all([
    getInspectionContext(id),
    getInspections(id),
  ]);
  if (!order) notFound();

  const current = kind === 'reception' ? reception : restitution;
  const canWrite = !!role && INSPECTION_WRITE_ROLES.includes(role);
  const fileUrls = await signInspectionFiles(filesOf(reception, restitution));

  const client = order.clients as { first_name?: string; last_name?: string; company_name?: string; phone?: string } | null;
  const clientName = client ? client.company_name || [client.first_name, client.last_name].filter(Boolean).join(' ') : null;

  const header = (
    <>
      <div className="flex flex-wrap items-center gap-1 text-xs text-gray-400 print:hidden">
        <Link href="/atelier" className="hover:text-kf-navy">
          Atelier / SAV
        </Link>
        <IconChevronRight className="w-3 h-3" />
        <Link href={`/atelier/${order.id}`} className="hover:text-kf-navy">
          {order.order_number}
        </Link>
        <IconChevronRight className="w-3 h-3" />
        <span className="text-gray-600">{INSPECTION_KIND_LABELS[kind]}</span>
      </div>
      <div className="card p-4 space-y-1">
        <h1 className="page-title">{INSPECTION_KIND_LABELS[kind]}</h1>
        <p className="text-sm text-encre-2">
          Ordre de réparation {order.order_number}
          {clientName ? ` · ${clientName}` : ''}
        </p>
        <p className="text-xs text-encre-3">
          {order.vehicle_label || 'Véhicule non précisé'}
          {order.vehicle_plate ? ` · ${order.vehicle_plate}` : ''}
          {order.vehicle_vin ? ` · VIN ${order.vehicle_vin}` : ''}
        </p>
      </div>
    </>
  );

  // Restitution : seulement après une réception signée par le client.
  if (kind === 'restitution' && !reception?.client_signed_at) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {header}
        <div className="card p-4 space-y-3">
          <p className="text-sm text-encre-2">
            La fiche de restitution se remplit après la fiche de réception signée par le client, pour pouvoir comparer
            l&apos;état du véhicule à l&apos;entrée et à la sortie.
          </p>
          <Link href={`/atelier/${order.id}/inspection/reception`} className="btn-primary">
            {reception ? 'Terminer la fiche de réception' : 'Remplir la fiche de réception'}
          </Link>
        </div>
      </div>
    );
  }

  const readOnly = !!current?.client_signed_at || !canWrite;

  if (readOnly) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {header}
        {current ? (
          <>
            <div className="flex flex-wrap gap-2 print:hidden">
              {current.client_signed_at && (
                <a href={`/api/atelier/${order.id}/inspection/${kind}/pdf`} target="_blank" rel="noopener noreferrer" className="btn-primary">
                  Télécharger le PDF
                </a>
              )}
              <PrintButton />
              {kind === 'reception' && current.client_signed_at && canWrite && !restitution && (
                <Link href={`/atelier/${order.id}/inspection/restitution`} className="btn-secondary">
                  Passer à la restitution
                </Link>
              )}
            </div>
            {kind === 'restitution' && reception && <InspectionComparison entry={reception} exit={current} />}
            <InspectionView inspection={current} fileUrls={fileUrls} />
          </>
        ) : (
          <div className="card p-4">
            <p className="text-sm text-encre-2">
              Cette fiche n&apos;a pas encore été remplie. Seuls la réception SAV, le chef d&apos;atelier et la direction
              peuvent la remplir.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {header}
      {kind === 'restitution' && reception && (
        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-medium text-encre">Rappel : état du véhicule à l&apos;entrée</summary>
          <div className="mt-3">
            <InspectionView inspection={reception} fileUrls={fileUrls} />
          </div>
        </details>
      )}
      <InspectionForm
        repairOrderId={order.id}
        organizationId={order.organization_id}
        kind={kind}
        initial={current}
        reception={reception}
        defaultReceptionistName={userName}
        fileUrls={fileUrls}
      />
    </div>
  );
}
