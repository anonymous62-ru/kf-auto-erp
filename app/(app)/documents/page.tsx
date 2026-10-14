import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { IconPlus } from '@/components/icons';
import { formatAmount } from '@/components/dashboard/widgets';
import { DOCUMENT_TYPE_LABELS, documentStatus, clientDisplayName } from '@/lib/documents/labels';
import { INVOICE_EDITOR_ROLES } from '@/lib/documents/invoice-rules';
import { SHOWROOM_ROLES } from '@/lib/users/roles';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { PAGE_SIZE, Pagination, SortHeader, pageFromParam } from '@/components/ui/pagination';

// Liste des factures proforma, commandes, factures et avoirs. La RLS décide
// de ce que chacun voit : un commercial ne reçoit que ses propres documents.

const TYPE_FILTERS = ['devis', 'commande', 'facture', 'avoir', 'bon_livraison', 'recu'];

// Même vocabulaire que les badges (direction, 10/10).
const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: 'brouillon', label: 'Brouillon' },
  { key: 'envoye', label: 'Envoyé' },
  { key: 'commande', label: 'Commande' },
  { key: 'facture', label: 'Facturé' },
  { key: 'paye', label: 'Payé' },
  { key: 'retard', label: 'En retard' },
  { key: 'avoir', label: 'Avoir' },
  { key: 'annule', label: 'Annulé' },
];

const SORTS: Record<string, string> = {
  numero: 'document_number',
  date: 'issue_date',
  montant: 'total_amount',
  reste: 'balance_due',
};

type ClientRel = { first_name: string | null; last_name: string | null; company_name: string | null };
type SP = {
  type?: string;
  statut?: string;
  status?: string;
  q?: string;
  du?: string;
  au?: string;
  commercial?: string;
  tri?: string;
  ordre?: string;
  page?: string;
};

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { type, q, du, au, commercial } = sp;
  const statut = sp.statut ?? sp.status;
  const sort = sp.tri && SORTS[sp.tri] ? sp.tri : '';
  const dir: 'asc' | 'desc' = sp.ordre === 'asc' ? 'asc' : 'desc';
  const page = pageFromParam(sp.page);
  const dateOk = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user?.id ?? '').maybeSingle();
  const role = profile?.role ?? '';
  const isShowroom = SHOWROOM_ROLES.includes(role);
  const canInvoice = INVOICE_EDITOR_ROLES.includes(role);
  const seesAll = ['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes'].includes(role);
  const { data: commercials } = seesAll
    ? await supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name')
    : { data: null };

  let request = supabase
    .from('documents')
    .select(
      'id, document_number, document_type, status, issue_date, due_date, total_amount, balance_due, clients(first_name, last_name, company_name)',
      { count: 'exact' }
    );

  if (type && TYPE_FILTERS.includes(type)) request = request.eq('document_type', type);
  switch (statut) {
    case 'brouillon':
    case 'envoye':
    case 'paye':
    case 'annule':
      request = request.eq('status', statut);
      break;
    case 'commande':
      request = request.in('document_type', ['devis', 'proforma']).eq('status', 'accepte');
      break;
    case 'facture':
      request = request.eq('document_type', 'facture').in('status', ['envoye', 'paye_partiel']);
      break;
    case 'retard':
      request = request
        .eq('document_type', 'facture')
        .in('status', ['envoye', 'paye_partiel'])
        .gt('balance_due', 0)
        .lt('due_date', today);
      break;
    case 'avoir':
      request = request.eq('document_type', 'avoir');
      break;
  }
  if (q?.trim()) request = request.ilike('document_number', `%${q.trim()}%`);
  if (dateOk(du)) request = request.gte('issue_date', du as string);
  if (dateOk(au)) request = request.lte('issue_date', au as string);
  if (seesAll && commercial) request = request.eq('commercial_id', commercial);

  request = sort
    ? request.order(SORTS[sort], { ascending: dir === 'asc', nullsFirst: false }).order('created_at', { ascending: false })
    : request.order('created_at', { ascending: false });
  request = request.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const { data, error, count } = await request;
  const documents = (data ?? []) as {
    id: string;
    document_number: string | null;
    document_type: string;
    status: string;
    issue_date: string | null;
    due_date: string | null;
    total_amount: number;
    balance_due: number;
    clients: ClientRel | ClientRel[] | null;
  }[];
  const total = count ?? documents.length;

  function href(next: Partial<Record<keyof SP, string | null>>) {
    const params = new URLSearchParams();
    const merged: Record<string, string | undefined | null> = {
      type,
      statut,
      q,
      du: dateOk(du) ? du : undefined,
      au: dateOk(au) ? au : undefined,
      commercial,
      tri: sort || undefined,
      ordre: sort ? dir : undefined,
      ...next,
    };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/documents?${qs}` : '/documents';
  }
  const sortHref = (column: string, d: 'asc' | 'desc') => href({ tri: column, ordre: d, page: null });
  const filtered = !!(type || statut || q || dateOk(du) || dateOk(au) || commercial);

  return (
    <div>
      <PageHeader
        title={isShowroom ? 'Mes factures proforma' : 'Documents'}
        description="Factures proforma, commandes, factures et avoirs"
        actions={
          <>
            {canInvoice && (
              <Link href="/documents/new/facture" className="btn-secondary">
                Nouvelle facture
              </Link>
            )}
            <Link href="/documents/new/devis" className="btn-primary">
              <IconPlus className="h-4 w-4" /> Nouvelle facture proforma
            </Link>
          </>
        }
      />

      {/* Filtres en haut du tableau */}
      <form action="/documents" className="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-gray-200 bg-white p-3 lg:flex lg:flex-wrap lg:items-end">
        <label className="col-span-2 block lg:w-40">
          <span className="field-label">Numéro</span>
          <input name="q" defaultValue={q ?? ''} placeholder="FAC-2026-..." className="input h-9 py-1.5" />
        </label>
        {!isShowroom && (
          <label className="block">
            <span className="field-label">Type</span>
            <select name="type" defaultValue={type ?? ''} className="input h-9 py-1.5 lg:w-36">
              <option value="">Tous</option>
              {TYPE_FILTERS.map((t) => (
                <option key={t} value={t}>
                  {DOCUMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="field-label">Statut</span>
          <select name="statut" defaultValue={statut ?? ''} className="input h-9 py-1.5 lg:w-32">
            <option value="">Tous</option>
            {STATUS_FILTERS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {seesAll && commercials && commercials.length > 1 && (
          <label className="hidden sm:block">
            <span className="field-label">Commercial</span>
            <select name="commercial" defaultValue={commercial ?? ''} className="input h-9 py-1.5 lg:w-40">
              <option value="">Tous</option>
              {commercials.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="hidden sm:block">
          <span className="field-label">Du</span>
          <input type="date" name="du" defaultValue={dateOk(du) ? du : ''} className="input h-9 py-1.5 lg:w-[8.5rem]" />
        </label>
        <label className="hidden sm:block">
          <span className="field-label">Au</span>
          <input type="date" name="au" defaultValue={dateOk(au) ? au : ''} className="input h-9 py-1.5 lg:w-[8.5rem]" />
        </label>
        {sort && <input type="hidden" name="tri" value={sort} />}
        {sort && <input type="hidden" name="ordre" value={dir} />}
        <div className="col-span-2 flex gap-2 lg:ml-auto">
          <button type="submit" className="btn-primary flex-1 lg:flex-none">
            Filtrer
          </button>
          {filtered && (
            <Link href="/documents" className="btn-ghost flex-1 lg:flex-none">
              Réinitialiser
            </Link>
          )}
        </div>
      </form>

      {error && (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Impossible de charger les documents : {error.message}
        </p>
      )}

      <div className="table-wrap">
        {documents.length === 0 ? (
          filtered ? (
            <EmptyState
              title="Aucun document ne correspond à ces filtres"
              description="Élargissez la période ou retirez un filtre."
              action={{ href: '/documents', label: 'Voir tous les documents' }}
            />
          ) : (
            <EmptyState
              title="Aucun document pour l'instant"
              description="Commencez par une facture proforma : elle se transforme ensuite en commande puis en facture."
              action={{ href: '/documents/new/devis', label: 'Créer une facture proforma' }}
            />
          )
        ) : (
          <>
            <table className="data-table hidden md:table">
              <thead>
                <tr>
                  <SortHeader label="Numéro" column="numero" sort={sort} dir={dir} hrefFor={sortHref} />
                  <th>Type</th>
                  <th>Client</th>
                  <SortHeader label="Date" column="date" sort={sort} dir={dir} hrefFor={sortHref} />
                  <SortHeader label="Montant TTC" column="montant" sort={sort} dir={dir} hrefFor={sortHref} align="right" />
                  <SortHeader label="Reste dû" column="reste" sort={sort} dir={dir} hrefFor={sortHref} align="right" />
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => {
                  const due = Number(d.balance_due);
                  const s = documentStatus(d.status, d.document_type, { dueDate: d.due_date, balance: due });
                  const client = clientDisplayName(Array.isArray(d.clients) ? d.clients[0] : d.clients);
                  const showDue = due > 0 && d.document_type === 'facture' && d.status !== 'annule';
                  return (
                    <tr key={d.id}>
                      <td>
                        <Link href={`/documents/${d.id}`} className="font-medium text-[#1f2937] hover:text-kf-navy">
                          {d.document_number ?? 'Sans numéro'}
                        </Link>
                      </td>
                      <td className="text-gray-600">{DOCUMENT_TYPE_LABELS[d.document_type] ?? d.document_type}</td>
                      <td className="max-w-[240px] truncate text-gray-700">{client}</td>
                      <td className="tabular-nums whitespace-nowrap text-gray-500">
                        {d.issue_date ? new Date(d.issue_date).toLocaleDateString('fr-FR') : ''}
                      </td>
                      <td className="num whitespace-nowrap font-medium">{formatAmount(Number(d.total_amount))}</td>
                      <td className={`num whitespace-nowrap ${showDue ? 'text-[#1f2937]' : 'text-gray-400'}`}>
                        {showDue ? formatAmount(due) : '-'}
                      </td>
                      <td>
                        <span className={s.badge}>{s.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <ul className="divide-y divide-gray-100 md:hidden">
              {documents.map((d) => {
                const s = documentStatus(d.status, d.document_type, { dueDate: d.due_date, balance: Number(d.balance_due) });
                const client = clientDisplayName(Array.isArray(d.clients) ? d.clients[0] : d.clients);
                return (
                  <li key={d.id}>
                    <Link href={`/documents/${d.id}`} className="flex items-start justify-between gap-3 px-3 py-3 hover:bg-gray-50">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-[#1f2937]">{client}</span>
                        <span className="block text-xs text-gray-500">
                          {DOCUMENT_TYPE_LABELS[d.document_type] ?? d.document_type} {d.document_number ?? ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="num block text-sm font-medium">{formatAmount(Number(d.total_amount))}</span>
                        <span className={`${s.badge} mt-1`}>{s.label}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <Pagination page={page} total={total} hrefFor={(p) => href({ page: p > 1 ? String(p) : null })} />
          </>
        )}
      </div>
    </div>
  );
}
