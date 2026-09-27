import { createClient } from '@/lib/supabase/server';
import { ProspectForm } from '@/components/prospects/prospect-form';

export default async function NewProspectPage() {
  const supabase = await createClient();
  const { data: vehicles } = await supabase
    .from('products')
    .select('id, designation')
    .eq('is_active', true)
    .order('designation');

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium">Nouveau prospect</h1>
      <ProspectForm vehicles={vehicles ?? []} />
    </div>
  );
}
