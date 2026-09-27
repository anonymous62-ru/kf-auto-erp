import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getProspect,
  getProspectActivities,
  getProspectAppointments,
} from '@/lib/prospects/actions';
import { ProspectActivityLog } from '@/components/prospects/prospect-activity-log';
import { ProspectAppointments } from '@/components/prospects/prospect-appointments';
import { ProspectStatusSelect } from '@/components/prospects/prospect-status-select';
import { ConvertToClientButton } from '@/components/prospects/convert-to-client-button';
import { IconPhone, IconChat, IconMail, IconTarget } from '@/components/icons';

export default async function ProspectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let prospect;
  try {
    prospect = await getProspect(id);
  } catch {
    notFound();
  }
  if (!prospect) notFound();

  const [activities, appointments] = await Promise.all([
    getProspectActivities(id),
    getProspectAppointments(id),
  ]);

  const name = `${prospect.first_name ?? ''} ${prospect.last_name ?? ''}`.trim() || 'Prospect sans nom';
  const waNumber = (prospect.whatsapp || prospect.phone || '').replace(/[^0-9]/g, '');
  const vehicleLabel =
    (prospect.products as { designation?: string } | null)?.designation || prospect.vehicle_interest;

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <IconTarget className="w-3.5 h-3.5" /> Prospect
            </p>
            <h1 className="text-lg font-medium">{name}</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ProspectStatusSelect prospectId={prospect.id} status={prospect.status} />
            <Link href={`/prospects/${prospect.id}/edit`} className="btn-secondary text-xs px-2.5 py-1.5">
              Modifier
            </Link>
          </div>
        </div>

        <div className="text-sm text-gray-600 mt-2 space-y-1">
          {prospect.phone && (
            <p className="flex items-center gap-1.5">
              <IconPhone className="w-3.5 h-3.5 text-gray-400" /> {prospect.phone}
            </p>
          )}
          {prospect.email && (
            <p className="flex items-center gap-1.5">
              <IconMail className="w-3.5 h-3.5 text-gray-400" /> {prospect.email}
            </p>
          )}
          {vehicleLabel && <p className="text-xs text-gray-500">Intéressé par : {vehicleLabel}</p>}
        </div>
        {prospect.notes && <p className="text-xs text-gray-500 mt-2 border-t pt-2">{prospect.notes}</p>}

        {waNumber && (
          <a
            href={`https://wa.me/${waNumber}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex items-center justify-center gap-1.5 w-full border border-green-200 text-green-700 rounded-md py-2 text-sm font-medium"
          >
            <IconChat className="w-4 h-4" /> Écrire sur WhatsApp
          </a>
        )}
      </div>

      {prospect.status !== 'converti' ? (
        <ConvertToClientButton prospectId={prospect.id} />
      ) : (
        prospect.client_id && (
          <Link href={`/clients/${prospect.client_id}`} className="btn-secondary w-full justify-center">
            Voir la fiche client
          </Link>
        )
      )}

      <ProspectAppointments prospectId={prospect.id} appointments={appointments} />
      <ProspectActivityLog prospectId={prospect.id} activities={activities} />
    </div>
  );
}
