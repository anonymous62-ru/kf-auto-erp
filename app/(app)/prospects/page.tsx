import Link from 'next/link';
import { getProspects } from '@/lib/prospects/actions';
import { ProspectList } from '@/components/prospects/prospect-list';
import { IconPlus } from '@/components/icons';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';

export default async function ProspectsPage({ searchParams }: { searchParams: Promise<{ commercial?: string }> }) {
  const { commercial } = await searchParams;
  const prospects = await getProspects(undefined, commercial || undefined);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user?.id ?? '').maybeSingle();
  // Export réservé à la direction (voir app/api/export/[kind]/route.ts).
  const canExport = ['super_admin', 'administrateur', 'manager'].includes(me?.role ?? '');
  // Filtre par commercial pour ceux qui voient les leads de tout le monde.
  const seesAll = ['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes', 'marketing'].includes(
    me?.role ?? ''
  );
  const { data: commercials } = seesAll
    ? await supabase.from('profiles').select('id, full_name').in('role', ['commercial', 'chef_service']).eq('is_active', true).order('full_name')
    : { data: null };

  return (
    <div className="space-y-3">
      <PageHeader
        title="Leads"
        description="Contacts à transformer en clients : relances, rendez-vous, catalogues envoyés."
        actions={
          <>
            {canExport && (
              <a href="/api/export/prospects" className="btn-secondary">
                Exporter
              </a>
            )}
            <Link href="/prospects/import" className="btn-secondary">
              Importer
            </Link>
            <Link href="/prospects/new" className="btn-primary">
              <IconPlus className="h-4 w-4" /> Nouveau lead
            </Link>
          </>
        }
      />
      {commercials && commercials.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <Link
            href="/prospects"
            className={`chip ${!commercial ? 'chip-active' : ''}`}
          >
            Tous les commerciaux
          </Link>
          {commercials.map((c) => (
            <Link
              key={c.id}
              href={`/prospects?commercial=${c.id}`}
              className={`chip ${commercial === c.id ? 'chip-active' : ''}`}
            >
              {c.full_name}
            </Link>
          ))}
        </div>
      )}
      <ProspectList key={commercial ?? 'tous'} initialProspects={prospects} assignedTo={commercial || undefined} />
    </div>
  );
}
