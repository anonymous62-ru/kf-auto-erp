import Link from 'next/link';
import { getProspects } from '@/lib/prospects/actions';
import { ProspectList } from '@/components/prospects/prospect-list';
import { IconPlus } from '@/components/icons';
import { createClient } from '@/lib/supabase/server';

export default async function ProspectsPage() {
  const prospects = await getProspects();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user?.id ?? '').maybeSingle();
  // Export réservé à la direction (voir app/api/export/[kind]/route.ts).
  const canExport = ['super_admin', 'administrateur', 'manager'].includes(me?.role ?? '');

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Prospects</h1>
        <div className="flex flex-wrap gap-2">
          {canExport && (
            <a href="/api/export/prospects" className="btn-secondary">
              Exporter (Excel)
            </a>
          )}
          <Link href="/prospects/import" className="btn-secondary">
            Importer un fichier
          </Link>
          <Link href="/prospects/new" className="btn-primary">
            <IconPlus className="w-4 h-4" /> Nouveau
          </Link>
        </div>
      </div>
      <ProspectList initialProspects={prospects} />
    </div>
  );
}
