import { getRepairOrder } from '@/lib/atelier/actions';
import { getPartOptions } from '@/lib/pieces/actions';
import { RepairOrderItems } from '@/components/atelier/repair-order-items';
import { RepairOrderActions } from '@/components/atelier/repair-order-actions';
import { DiagnosticForm } from '@/components/atelier/diagnostic-form';
import { formatCFA } from '@/lib/documents/calculations';
import Link from 'next/link';
import { IconChevronRight } from '@/components/icons';

const STATUS_LABELS: Record<string, string> = {
  ouvert: 'Ouvert',
  en_cours: 'En cours',
  en_attente_pieces: 'En attente pièces',
  termine: 'Terminé',
  facture: 'Facturé',
  annule: 'Annulé',
};

export default async function RepairOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ order, items }, parts] = await Promise.all([getRepairOrder(id), getPartOptions()]);

  const client = order.clients as any;
  const clientName = client ? client.company_name || [client.first_name, client.last_name].filter(Boolean).join(' ') : null;
  const readOnly = ['termine', 'facture', 'annule'].includes(order.status);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <Link href="/atelier" className="hover:text-kf-navy">
          Atelier / SAV
        </Link>
        <IconChevronRight className="w-3 h-3" />
        <span className="text-gray-600">{order.order_number}</span>
      </div>

      <div className="card p-4 space-y-1">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-medium">{order.order_number}</h1>
          <span className="badge badge-navy">{STATUS_LABELS[order.status] ?? order.status}</span>
        </div>
        <p className="text-sm text-gray-600">{clientName || 'Aucun client associé'}</p>
        <p className="text-xs text-gray-500">
          {order.vehicle_label || 'Véhicule non précisé'} {order.vehicle_plate && `— ${order.vehicle_plate}`} {order.vehicle_vin && `— VIN ${order.vehicle_vin}`}
        </p>
        <p className="text-xs text-gray-500">
          Ouvert le {new Date(order.opened_at).toLocaleDateString('fr-FR')}
          {order.closed_at && ` · Terminé le ${new Date(order.closed_at).toLocaleDateString('fr-FR')}`}
        </p>
        <p className="text-sm font-semibold pt-1">Total devis : {formatCFA(Number(order.quote_total))}</p>
      </div>

      <RepairOrderActions
        repairOrderId={order.id}
        status={order.status}
        quoteStatus={order.quote_status}
        hasInvoice={!!order.document_id}
      />

      <DiagnosticForm
        repairOrderId={order.id}
        diagnostic={order.diagnostic}
        laborHoursPlanned={Number(order.labor_hours_planned)}
        laborHoursActual={Number(order.labor_hours_actual)}
        laborRate={Number(order.labor_rate)}
        vehicleMileageIn={order.vehicle_mileage_in}
      />

      <RepairOrderItems repairOrderId={order.id} items={items} parts={parts} readOnly={readOnly} />
    </div>
  );
}
