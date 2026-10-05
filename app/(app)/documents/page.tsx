import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { IconPlus } from '@/components/icons';
import { formatAmount } from '@/components/dashboard/widgets';
import { DOCUMENT_TYPE_LABELS, DOCUMENT_STATUS, documentStatus, clientDisplayName } from '@/lib/documents/labels';

// Liste des devis/proformas/factures. La RLS décide de ce que chacun voit :
// un commercial ou la responsable showroom ne reçoivent que leurs propres
// documents, la caissière/secrétaire/manager/admin voient toute l'organisation.

const TYPE_FILTERS = ['facture', 'devis', 'proforma', 'bon_livraison', 'recu', 'avoir'];

type ClientRel = { first_name: string | null; last_name: string | null; company_name: string | null };

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string; q?: string }>;
}) {
  const { type, status, q } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user?.id ?? '').maybeSingle();
  const isShowroom = profile?.role === 'responsable_showroom';

  let request = supabase
    .from('documents')
    .select(
      'id, document_number, document_type, status, issue_date, due_date, total_amount, balance_due, clients(first_name, last_name, company_name)'
    )
    .order('created_at', { ascending: false })
    .limit(200);

  if (type && TYPE_FILTERS.includes(type)) request = request.eq('document_type', type);
  if (status && DOCUMENT_STATUS[status]) request = request.eq('status', status);
  if (q?.trim()) request = request.ilike('document_number', `%${q.trim()}%`);

  const { data, error } = await request;
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

  function filterHref(next: { type?: string | null; status?: string | null }) {
    const params = new URLSearchParams();
    const t = next.type === undefined ? type : next.type;
    const s = next.status === undefined ? status : next.status;
    if (t) params.set('type', t);
    if (s) params.set('status', s);
    if (q) params.set('q', q);
    const qs = params.toString();
    return qs ? `/documents?${qs}` : '/documents';
  }

  const pill = (active: boolean) =>
    `inline-flex items-center rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
      active ? 'bg-kf-navy text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
    }`;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
            {isShowroom ? 'Mes proformas' : 'Devis et factures'}
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {documents.length} document{documents.length > 1 ? 's' : ''}
            {documents.length === 200 ? ' (200 plus récents)' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isShowroom ? (
            <Link href="/documents/new/proforma" className="btn-primary">
              <IconPlus className="w-4 h-4" /> Nouveau proforma
            </Link>
          ) : (
            <>
              <Link href="/documents/new/proforma" className="btn-secondary">
                Nouveau proforma
              </Link>
              <Link href="/documents/new/facture" className="btn-secondary">
                Nouvelle facture
              </Link>
              <Link href="/documents/new/devis" className="btn-primary">
                <IconPlus className="w-4 h-4" /> Nouveau devis
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="card p-3 sm:p-4 space-y-3">
        <form action="/documents" className="flex gap-2">
          {type && <input type="hidden" name="type" value={type} />}
          {status && <input type="hidden" name="status" value={status} />}
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Rechercher un numéro de document"
            className="input"
          />
          <button type="submit" className="btn-secondary shrink-0">
            Rechercher
          </button>
        </form>
        {!isShowroom && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            <Link href={filterHref({ type: null })} className={pill(!type)}>
              Tous les types
            </Link>
            {TYPE_FILTERS.map((t) => (
              <Link key={t} href={filterHref({ type: t })} className={pill(type === t)}>
                {DOCUMENT_TYPE_LABELS[t]}
              </Link>
            ))}
          </div>
        )}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <Link href={filterHref({ status: null })} className={pill(!status)}>
            Tous les statuts
          </Link>
          {Object.entries(DOCUMENT_STATUS).map(([key, s]) => (
            <Link key={key} href={filterHref({ status: key })} className={pill(status === key)}>
              {s.label}
            </Link>
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Impossible de charger les documents : {error.message}
        </p>
      )}

      <div className="card overflow-hidden">
        {documents.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-gray-500">Aucun document ne correspond à ces critères.</p>
        ) : (
          <>
            <table className="hidden md:table w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50/60">
                  <th className="px-5 py-2.5 font-medium">Numéro</th>
                  <th className="px-3 py-2.5 font-medium">Type</th>
                  <th className="px-3 py-2.5 font-medium">Client</th>
                  <th className="px-3 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium text-right">Montant TTC</th>
                  <th className="px-3 py-2.5 font-medium text-right">Reste dû</th>
                  <th className="px-5 py-2.5 font-medium text-right">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {documents.map((d) => {
                  const s = documentStatus(d.status);
                  const client = clientDisplayName(Array.isArray(d.clients) ? d.clients[0] : d.clients);
                  const due = Number(d.balance_due);
                  return (
                    <tr key={d.id} className="hover:bg-gray-50/70">
                      <td className="px-5 py-3">
                        <Link href={`/documents/${d.id}`} className="font-medium text-gray-900 hover:text-kf-navy">
                          {d.document_number ?? 'Sans numéro'}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-gray-600">{DOCUMENT_TYPE_LABELS[d.document_type] ?? d.document_type}</td>
                      <td className="px-3 py-3 text-gray-700 max-w-[220px] truncate">{client}</td>
                      <td className="px-3 py-3 text-gray-500 whitespace-nowrap">
                        {d.issue_date ? new Date(d.issue_date).toLocaleDateString('fr-FR') : ''}
                      </td>
                      <td className="num px-3 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                        {formatAmount(Number(d.total_amount))}
                      </td>
                      <td className={`num px-3 py-3 text-right whitespace-nowrap ${due > 0 && d.document_type === 'facture' ? 'text-red-600' : 'text-gray-400'}`}>
                        {due > 0 && d.document_type === 'facture' ? formatAmount(due) : '-'}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className={s.badge}>{s.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <ul className="md:hidden divide-y divide-gray-100">
              {documents.map((d) => {
                const s = documentStatus(d.status);
                const client = clientDisplayName(Array.isArray(d.clients) ? d.clients[0] : d.clients);
                return (
                  <li key={d.id}>
                    <Link href={`/documents/${d.id}`} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-gray-50">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-900 truncate">{client}</span>
                        <span className="block text-xs text-gray-500">
                          {DOCUMENT_TYPE_LABELS[d.document_type] ?? d.document_type} {d.document_number ?? ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="num block text-sm font-medium text-gray-900">
                          {formatAmount(Number(d.total_amount))}
                        </span>
                        <span className={`${s.badge} mt-1`}>{s.label}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
