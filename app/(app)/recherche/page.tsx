import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { applyClientSearch, searchTerms } from '@/lib/search';
import { documentTypeLabel, DOCUMENT_STATUS } from '@/lib/documents/labels';
import { vehicleStatus } from '@/lib/stock/labels';

// Recherche globale (barre du haut) : clients, documents par numéro,
// véhicules par numéro de châssis, leads. Chaque bloc respecte les droits
// de lecture de l'utilisateur (RLS) : un bloc vide est simplement masqué.

export const dynamic = 'force-dynamic';

type Row = { href: string; title: string; detail?: string | null; badge?: { label: string; badge: string } | null; amount?: number | null };

function personName(p: { first_name?: string | null; last_name?: string | null; company_name?: string | null } | null | undefined) {
  if (!p) return '';
  return p.company_name || [p.first_name, p.last_name].filter(Boolean).join(' ');
}

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(n).replace(/[  ]/g, ' ');

export default async function RecherchePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q: raw } = await searchParams;
  const q = (raw ?? '').trim().slice(0, 80);
  const terms = searchTerms(q);

  if (terms.length === 0) {
    return (
      <div>
        <PageHeader title="Recherche" description="Saisissez un nom de client, un numéro de document ou un numéro de châssis." />
        <SearchForm q={q} />
      </div>
    );
  }

  const supabase = await createClient();
  // Pour les numéros (document, châssis) : la saisie entière, sans espaces.
  const compact = terms.join('').replace(/[%_]/g, '');

  const [clients, documents, vehicles, leads] = await Promise.all([
    applyClientSearch(
      supabase.from('clients').select('id, first_name, last_name, company_name, phone, client_number'),
      q
    )
      .order('updated_at', { ascending: false })
      .limit(8),
    supabase
      .from('documents')
      .select('id, document_number, document_type, status, total_amount, clients(first_name, last_name, company_name)')
      .ilike('document_number', `%${compact}%`)
      .order('created_at', { ascending: false })
      .limit(8),
    compact.length >= 4
      ? supabase
          .from('vehicle_units')
          .select('id, vin, color, status, products(designation)')
          .ilike('vin', `%${compact}%`)
          .order('entry_date', { ascending: true })
          .limit(8)
      : Promise.resolve({ data: [] as unknown[] }),
    (() => {
      let r = supabase.from('prospects').select('id, first_name, last_name, company_name, phone, vehicle_interest, status');
      for (const t of terms) {
        r = r.or(`first_name.ilike.%${t}%,last_name.ilike.%${t}%,company_name.ilike.%${t}%,phone.ilike.%${t}%`);
      }
      return r.order('created_at', { ascending: false }).limit(8);
    })(),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const groups: { title: string; more?: string; rows: Row[] }[] = [
    {
      title: 'Clients',
      more: `/clients?q=${encodeURIComponent(q)}`,
      rows: ((clients.data ?? []) as any[]).map((c) => ({
        href: `/clients/${c.id}`,
        title: personName(c) || 'Client sans nom',
        detail: [c.client_number ? `N° ${c.client_number}` : null, c.phone].filter(Boolean).join(', '),
      })),
    },
    {
      title: 'Proformas, commandes et factures',
      rows: ((documents.data ?? []) as any[]).map((d) => ({
        href: `/documents/${d.id}`,
        title: `${documentTypeLabel(d.document_type)} ${d.document_number ?? ''}`.trim(),
        detail: personName(Array.isArray(d.clients) ? d.clients[0] : d.clients),
        badge: DOCUMENT_STATUS[d.status] ?? null,
        amount: Number(d.total_amount ?? 0),
      })),
    },
    {
      title: 'Véhicules',
      rows: ((vehicles.data ?? []) as any[]).map((v) => {
        const st = vehicleStatus(v.status);
        const product = Array.isArray(v.products) ? v.products[0] : v.products;
        return {
          href: `/stock/${v.id}`,
          title: v.vin,
          detail: [product?.designation, v.color].filter(Boolean).join(', '),
          badge: { label: st.short, badge: st.badge },
        };
      }),
    },
    {
      title: 'Leads',
      rows: ((leads.data ?? []) as any[]).map((p) => ({
        href: `/prospects/${p.id}`,
        title: personName(p) || 'Lead sans nom',
        detail: [p.vehicle_interest, p.phone].filter(Boolean).join(', '),
      })),
    },
  ].filter((g) => g.rows.length > 0);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div>
      <PageHeader
        title="Recherche"
        description={total === 0 ? `Aucun résultat pour « ${q} ».` : `${total} résultat${total > 1 ? 's' : ''} pour « ${q} »`}
      />
      <SearchForm q={q} />
      {total === 0 ? (
        <div className="card px-6 py-10 text-center text-[13px] text-encre-3">
          Vérifiez l&apos;orthographe, ou cherchez par téléphone, numéro de facture ou fin de numéro de châssis.
        </div>
      ) : (
        <div className="grid gap-5">
          {groups.map((g) => (
            <section key={g.title} className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-trait px-4 py-3">
                <h2 className="font-display text-[15px] font-bold">{g.title}</h2>
                {g.more && (
                  <Link href={g.more} className="btn-link text-[13px]">
                    Voir tout
                  </Link>
                )}
              </div>
              <ul>
                {g.rows.map((r, i) => (
                  <li key={r.href} className={i > 0 ? 'border-t border-trait-2' : ''}>
                    <Link href={r.href} className="flex items-center gap-3 px-4 py-3 hover:bg-papier">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{r.title}</span>
                        {r.detail && <span className="block truncate text-xs text-encre-3">{r.detail}</span>}
                      </span>
                      {r.badge && <span className={r.badge.badge}>{r.badge.label}</span>}
                      {typeof r.amount === 'number' && r.amount > 0 && (
                        <span className="num hidden whitespace-nowrap text-[13px] text-encre-2 sm:inline">{fmt(r.amount)} FCFA</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchForm({ q }: { q: string }) {
  return (
    <form action="/recherche" role="search" className="mb-5 flex gap-2">
      <input name="q" type="search" defaultValue={q} className="input flex-1" aria-label="Rechercher" placeholder="Nom, téléphone, numéro de facture, châssis" />
      <button type="submit" className="btn-primary">
        Rechercher
      </button>
    </form>
  );
}
