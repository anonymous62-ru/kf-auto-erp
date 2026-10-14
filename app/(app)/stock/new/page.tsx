import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { can, getCurrentRole } from '@/lib/permissions';
import { VehicleEntryForm } from '@/components/stock/vehicle-entry-form';

export default async function VehicleEntryPage({ searchParams }: { searchParams: Promise<{ modele?: string }> }) {
  const role = await getCurrentRole();
  if (!can(role, 'vehicleUnitWrite')) redirect('/stock');
  const { modele } = await searchParams;
  const supabase = await createClient();
  const { data: products } = await supabase
    .from('products')
    .select('id, designation')
    .or('is_archived.is.null,is_archived.eq.false')
    .order('designation');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Entrée en stock</h1>
        <p className="mt-0.5 text-sm text-gray-500 max-w-2xl">
          Enregistrez chaque véhicule par son numéro de châssis. Dès qu&apos;un modèle a au moins un châssis saisi, son stock
          se calcule à partir des véhicules enregistrés : pensez à saisir tous les véhicules de ce modèle présents au parc.
        </p>
      </div>
      <VehicleEntryForm products={products ?? []} defaultProductId={modele} />
    </div>
  );
}
