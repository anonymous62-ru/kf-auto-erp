import { getClientOptions } from '@/lib/atelier/actions';
import { NewAppointmentForm } from '@/components/atelier/new-appointment-form';

export default async function NewAppointmentPage() {
  const clients = await getClientOptions();
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-medium">Nouveau rendez-vous atelier</h1>
      <NewAppointmentForm clients={clients} />
    </div>
  );
}
