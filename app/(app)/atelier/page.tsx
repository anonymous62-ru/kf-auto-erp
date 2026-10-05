import { getAppointments, getRepairOrders } from '@/lib/atelier/actions';
import { formatCFA } from '@/lib/documents/calculations';
import Link from 'next/link';
import { IconPlus, IconCalendar } from '@/components/icons';
import { can, getCurrentRole } from '@/lib/permissions';

const STATUS_LABELS: Record<string, string> = {
  ouvert: 'Ouvert',
  en_cours: 'En cours',
  en_attente_pieces: 'En attente pièces',
  termine: 'Terminé',
  facture: 'Facturé',
  annule: 'Annulé',
};

const STATUS_COLORS: Record<string, string> = {
  ouvert: 'badge-gray',
  en_cours: 'badge-orange',
  en_attente_pieces: 'badge-orange',
  termine: 'badge-green',
  facture: 'badge-green',
  annule: 'badge-gray',
};

function clientName(c: any) {
  if (!c) return 'Client non renseigné';
  return c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Client';
}

export default async function AtelierPage() {
  const role = await getCurrentRole();
  const [appointments, orders] = await Promise.all([getAppointments(), getRepairOrders()]);
  const upcoming = appointments.filter((a) => a.status === 'planifie' || a.status === 'confirme');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Atelier / SAV</h1>
        <div className="flex gap-2">
          {can(role, 'appointmentWrite') && (
            <Link href="/atelier/rendez-vous/new" className="btn-secondary text-sm px-3 py-1.5">
              <IconCalendar className="w-3.5 h-3.5" /> RDV
            </Link>
          )}
          {can(role, 'repairOrderCreate') && (
            <Link href="/atelier/new" className="btn-primary text-sm px-3 py-1.5">
              <IconPlus className="w-3.5 h-3.5" /> Nouvel OR
            </Link>
          )}
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-500">Prochains rendez-vous</h2>
          {upcoming.map((a: any) => (
            <div key={a.id} className="card p-3 text-sm flex justify-between items-center gap-3">
              <div className="min-w-0">
                <p className="font-medium truncate">{clientName(a.clients)}</p>
                <p className="text-xs text-gray-500">
                  {a.vehicle_label || a.vehicle_plate || 'Véhicule non précisé'} · {a.reason || 'Motif non précisé'}
                </p>
              </div>
              <p className="text-xs text-gray-500 whitespace-nowrap">
                {new Date(a.scheduled_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-500">Ordres de réparation</h2>
        {orders.length === 0 && (
          <div className="card p-4 text-sm text-gray-500">Aucun ordre de réparation pour le moment.</div>
        )}
        {orders.map((o: any) => (
          <Link key={o.id} href={`/atelier/${o.id}`} className="card card-hover p-3 text-sm flex justify-between items-center gap-3">
            <div className="min-w-0">
              <p className="font-medium truncate">
                {o.order_number} — {clientName(o.clients)}
              </p>
              <p className="text-xs text-gray-500">{o.vehicle_label || o.vehicle_plate || 'Véhicule non précisé'}</p>
            </div>
            <div className="text-right whitespace-nowrap">
              <span className={`badge ${STATUS_COLORS[o.status] ?? 'badge-gray'}`}>{STATUS_LABELS[o.status] ?? o.status}</span>
              <p className="text-xs text-gray-500 mt-1">{formatCFA(Number(o.quote_total))}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
