import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/permissions';
import { DIRECTION_ROLES } from '@/lib/users/roles';
import { DealForm } from '@/components/crm/deal-form';
import { clientDisplayName } from '@/lib/documents/labels';

export default async function NewDealPage({ searchParams }: { searchParams: Promise<{ clientId?: string; leadId?: string }> }) {
  const { clientId, leadId } = await searchParams;
  const me = await getCurrentProfile();
  const supabase = await createClient();

  const [{ data: products }, commercialsRes, client, lead] = await Promise.all([
    supabase
      .from('products')
      .select('id, designation, sale_price')
      .eq('is_active', true)
      .or('is_archived.is.null,is_archived.eq.false')
      .order('designation'),
    DIRECTION_ROLES.includes(me?.role ?? '')
      ? supabase.from('profiles').select('id, full_name').in('role', ['commercial', 'chef_service']).eq('is_active', true).order('full_name')
      : Promise.resolve({ data: null }),
    clientId
      ? supabase.from('clients').select('id, company_name, first_name, last_name, phone, status').eq('id', clientId).maybeSingle()
      : Promise.resolve({ data: null }),
    leadId
      ? supabase.from('prospects').select('id, company_name, first_name, last_name, phone').eq('id', leadId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const initialContact = client.data
    ? { kind: 'client' as const, id: client.data.id, name: clientDisplayName(client.data), phone: client.data.phone, status: client.data.status }
    : lead.data
      ? { kind: 'lead' as const, id: lead.data.id, name: clientDisplayName(lead.data), phone: lead.data.phone }
      : null;

  return (
    <div className="space-y-4">
      <h1 className="page-title">Nouvelle affaire</h1>
      <DealForm
        products={(products ?? []).map((p) => ({ id: p.id, designation: p.designation, sale_price: Number(p.sale_price) }))}
        commercials={commercialsRes.data ?? null}
        initialContact={initialContact}
      />
    </div>
  );
}
