import { createClient } from '@/lib/supabase/server';
import { ProspectForm } from '@/components/prospects/prospect-form';
import { getCurrentRole } from '@/lib/permissions';

export default async function NewProspectPage() {
  const supabase = await createClient();
  const role = await getCurrentRole();
  // La direction et la chargée marketing peuvent confier le lead à un commercial.
  const canAssign = ['super_admin', 'administrateur', 'manager', 'marketing'].includes(role ?? '');
  const [{ data: vehicles }, { data: campaigns }, commercialsRes] = await Promise.all([
    supabase.from('products').select('id, designation').eq('is_active', true).order('designation'),
    supabase.from('campaigns').select('id, name').in('status', ['preparation', 'en_cours']).order('start_date', { ascending: false }),
    canAssign
      ? supabase.from('profiles').select('id, full_name').in('role', ['commercial', 'chef_service', 'responsable_showroom', 'vendeur_showroom']).eq('is_active', true).order('full_name')
      : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="page-title">Nouveau lead</h1>
      <ProspectForm vehicles={vehicles ?? []} campaigns={campaigns ?? []} commercials={commercialsRes.data ?? null} />
    </div>
  );
}
