import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ClientSearchList } from '@/components/clients/client-search-list';
import { IconPlus } from '@/components/icons';

export default async function ClientsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user?.id ?? '').maybeSingle();
  // Export réservé à la direction (voir app/api/export/[kind]/route.ts).
  const canExport = ['super_admin', 'administrateur', 'manager'].includes(me?.role ?? '');
  const { data: clients } = await supabase
    .from('clients')
    .select('id, first_name, last_name, company_name, phone, city')
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Mes clients</h1>
        <div className="flex flex-wrap gap-2">
          {canExport && (
            <a href="/api/export/clients" className="btn-secondary">
              Exporter (Excel)
            </a>
          )}
          <Link href="/clients/import" className="btn-secondary">
            Importer un fichier
          </Link>
          <Link href="/clients/new" className="btn-primary">
            <IconPlus className="w-4 h-4" /> Nouveau
          </Link>
        </div>
      </div>
      <ClientSearchList initialClients={clients ?? []} />
    </div>
  );
}
