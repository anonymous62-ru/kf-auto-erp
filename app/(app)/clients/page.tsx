import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { IconPlus } from '@/components/icons';
import { clientStatus } from '@/lib/documents/labels';
import { applyClientSearch } from '@/lib/search';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { PAGE_SIZE, Pagination, SortHeader, pageFromParam } from '@/components/ui/pagination';

// Un contact reste « prospect » tant qu'il n'a rien versé ; il devient
// « client », avec son numéro client, au premier versement (règle du 09/10).

const SORTS: Record<string, string> = {
  nom: 'last_name',
  societe: 'company_name',
  numero: 'client_number',
  ajout: 'created_at',
};

type SP = { statut?: string; commercial?: string; q?: string; tri?: string; ordre?: string; page?: string };
type Owner = { full_name: string | null } | { full_name: string | null }[] | null;

export default async function ClientsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const status = sp.statut === 'client' || sp.statut === 'prospect' ? sp.statut : undefined;
  const q = (sp.q ?? '').trim();
  const sort = sp.tri && SORTS[sp.tri] ? sp.tri : '';
  const dir: 'asc' | 'desc' = sp.ordre === 'asc' ? 'asc' : 'desc';
  const page = pageFromParam(sp.page);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user?.id ?? '').maybeSingle();
  const canExport = ['super_admin', 'administrateur', 'manager'].includes(me?.role ?? '');
  const seesAll = ['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes', 'chef_atelier'].includes(
    me?.role ?? ''
  );
  const { data: commercials } = seesAll
    ? await supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name')
    : { data: null };
  const owner = seesAll && sp.commercial ? sp.commercial : undefined;

  let request = supabase
    .from('clients')
    .select(
      'id, first_name, last_name, company_name, phone, city, status, client_number, created_at, owner:profiles!clients_assigned_to_fkey(full_name)',
      { count: 'exact' }
    )
    .not('is_archived', 'is', true);
  if (status) request = request.eq('status', status);
  if (owner) request = request.eq('assigned_to', owner);
  if (q) request = applyClientSearch(request, q);
  request = sort
    ? request.order(SORTS[sort], { ascending: dir === 'asc', nullsFirst: false }).order('created_at', { ascending: false })
    : request.order('created_at', { ascending: false });
  request = request.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const { data, count, error } = await request;
  const clients = (data ?? []) as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    company_name: string | null;
    phone: string | null;
    city: string | null;
    status: string | null;
    client_number: string | null;
    created_at: string;
    owner: Owner;
  }[];

  function href(next: Partial<Record<keyof SP, string | null>>) {
    const params = new URLSearchParams();
    const merged: Record<string, string | null | undefined> = {
      statut: status,
      commercial: owner,
      q: q || undefined,
      tri: sort || undefined,
      ordre: sort ? dir : undefined,
      ...next,
    };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/clients?${qs}` : '/clients';
  }
  const sortHref = (column: string, d: 'asc' | 'desc') => href({ tri: column, ordre: d, page: null });
  const filtered = !!(status || owner || q);

  return (
    <div>
      <PageHeader
        title="Clients et prospects"
        description="Un contact devient client, avec son numéro, au premier versement."
        actions={
          <>
            {canExport && (
              <a href="/api/export/clients" className="btn-secondary">
                Exporter
              </a>
            )}
            <Link href="/clients/import" className="btn-secondary">
              Importer
            </Link>
            <Link href="/clients/new" className="btn-primary">
              <IconPlus className="h-4 w-4" /> Nouveau contact
            </Link>
          </>
        }
      />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex gap-1">
          {[
            { v: undefined, l: 'Tous' },
            { v: 'client', l: 'Clients' },
            { v: 'prospect', l: 'Prospects' },
          ].map((t) => (
            <Link key={t.l} href={href({ statut: t.v ?? null, page: null })} className={`chip ${status === t.v ? 'chip-active' : ''}`}>
              {t.l}
            </Link>
          ))}
        </div>
        <form action="/clients" className="flex flex-1 flex-wrap items-end gap-2 sm:justify-end">
          {status && <input type="hidden" name="statut" value={status} />}
          <input name="q" defaultValue={q} placeholder="Nom, société, téléphone" className="input h-9 min-w-0 flex-1 py-1.5 sm:max-w-xs" />
          {seesAll && commercials && commercials.length > 1 && (
            <select name="commercial" defaultValue={owner ?? ''} className="input h-9 w-auto py-1.5" aria-label="Commercial">
              <option value="">Tous les commerciaux</option>
              {commercials.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </select>
          )}
          <button type="submit" className="btn-secondary">
            Rechercher
          </button>
        </form>
      </div>

      {error && (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</p>
      )}

      <div className="table-wrap">
        {clients.length === 0 ? (
          filtered ? (
            <EmptyState title="Aucun contact ne correspond" description="Vérifiez l'orthographe ou retirez un filtre." action={{ href: '/clients', label: 'Voir tous les contacts' }} />
          ) : (
            <EmptyState
              title="Aucun contact pour l'instant"
              description="Ajoutez un client ou un prospect, ou importez votre fichier Excel existant."
              action={{ href: '/clients/new', label: 'Ajouter un contact' }}
            />
          )
        ) : (
          <>
            <table className="data-table hidden md:table">
              <thead>
                <tr>
                  <SortHeader label="Nom" column="nom" sort={sort} dir={dir} hrefFor={sortHref} />
                  <th>Téléphone</th>
                  <th>Ville</th>
                  <SortHeader label="N° client" column="numero" sort={sort} dir={dir} hrefFor={sortHref} />
                  <th>Commercial</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => {
                  const st = clientStatus(c.status);
                  const ownerName = (Array.isArray(c.owner) ? c.owner[0] : c.owner)?.full_name;
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/clients/${c.id}`} className="font-medium hover:text-kf-navy">
                          {c.company_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Sans nom'}
                        </Link>
                      </td>
                      <td className="tabular-nums whitespace-nowrap text-gray-600">{c.phone}</td>
                      <td className="text-gray-600">{c.city}</td>
                      <td className="tabular-nums text-gray-600">{c.client_number ?? '-'}</td>
                      <td className="text-gray-600">{ownerName ?? ''}</td>
                      <td>
                        <span className={st.badge}>{st.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ul className="divide-y divide-gray-100 md:hidden">
              {clients.map((c) => {
                const st = clientStatus(c.status);
                return (
                  <li key={c.id}>
                    <Link href={`/clients/${c.id}`} className="flex items-start justify-between gap-3 px-3 py-3 hover:bg-gray-50">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {c.company_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Sans nom'}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {[c.phone, c.city].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={st.badge}>{st.label}</span>
                        {c.client_number && <span className="num mt-1 block text-xs text-gray-500">{c.client_number}</span>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <Pagination page={page} total={count ?? clients.length} hrefFor={(p) => href({ page: p > 1 ? String(p) : null })} />
          </>
        )}
      </div>
    </div>
  );
}
