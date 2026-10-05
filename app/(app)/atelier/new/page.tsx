import { getClientOptions } from '@/lib/atelier/actions';
import { NewRepairOrderForm } from '@/components/atelier/new-repair-order-form';

export default async function NewRepairOrderPage() {
  const clients = await getClientOptions();
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-medium">Nouvel ordre de réparation</h1>
      <NewRepairOrderForm clients={clients} />
    </div>
  );
}
