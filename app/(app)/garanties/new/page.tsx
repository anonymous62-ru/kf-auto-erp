import { getClientOptions } from '@/lib/atelier/actions';
import { getVehicleModelOptions } from '@/lib/garanties/actions';
import { NewWarrantyForm } from '@/components/garanties/new-warranty-form';

export default async function NewWarrantyPage() {
  const [clients, models] = await Promise.all([getClientOptions(), getVehicleModelOptions()]);
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-medium">Nouvelle garantie constructeur</h1>
      <NewWarrantyForm clients={clients} models={models} />
    </div>
  );
}
