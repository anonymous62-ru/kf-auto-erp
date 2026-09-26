import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ClientSearchList } from '@/components/clients/client-search-list';

export default async function ClientsPage() {
  const supabase = await createClient();
  const { data: clients } = await supabase
    .from('clients')
    .select('id, first_name, last_name, company_name, phone, city')
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Mes clients</h1>
        <Link href="/clients/new" className="text-sm bg-kf-navy text-white rounded-md px-3 py-1.5">
          + Nouveau
        </Link>
      </div>
      <ClientSearchList initialClients={clients ?? []} />
    </div>
  );
}
