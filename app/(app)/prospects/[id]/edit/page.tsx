import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProspect } from '@/lib/prospects/actions';
import { ProspectEditForm } from '@/components/prospects/prospect-edit-form';

export default async function EditProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let prospect;
  try {
    prospect = await getProspect(id);
  } catch {
    notFound();
  }
  if (!prospect) notFound();

  const supabase = await createClient();
  const { data: vehicles } = await supabase
    .from('products')
    .select('id, designation')
    .eq('is_active', true)
    .order('designation');

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium">Modifier le prospect</h1>
      <ProspectEditForm prospect={prospect} vehicles={vehicles ?? []} />
    </div>
  );
}
