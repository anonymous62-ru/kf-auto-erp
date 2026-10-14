import Link from 'next/link';
import { getProducts } from '@/lib/products/actions';
import { formatCFA } from '@/lib/documents/calculations';
import { IconPlus } from '@/components/icons';
import { can, getCurrentRole } from '@/lib/permissions';
import { SendCatalogueButton } from '@/components/catalogue/send-catalogue';
import { listCatalogueChoices } from '@/lib/catalogue/actions';
import { CATALOGUE_SENDER_ROLES } from '@/lib/catalogue/roles';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { ViewToggle } from '@/components/ui/view-toggle';

// Catalogue véhicules : vue grille (photo principale) ou liste.
export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ vue?: string }> }) {
  const { vue } = await searchParams;
  const view = vue === 'liste' ? 'liste' : 'grille';
  const role = await getCurrentRole();
  const [products, choices] = await Promise.all([getProducts(), listCatalogueChoices()]);
  const canSend = CATALOGUE_SENDER_ROLES.includes(role ?? '');
  const canCreate = can(role, 'productWrite');

  return (
    <div>
      <PageHeader
        title="Catalogue véhicules"
        description={`${products.length} modèle${products.length > 1 ? 's' : ''}`}
        actions={
          <>
            <ViewToggle view={view} hrefFor={(v) => (v === 'liste' ? '/products?vue=liste' : '/products')} />
            {canSend && choices.length > 0 && <SendCatalogueButton choices={choices} variant="secondary" />}
            {canCreate && (
              <Link href="/products/new" className="btn-primary">
                <IconPlus className="h-4 w-4" /> Nouveau modèle
              </Link>
            )}
          </>
        }
      />

      {products.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Aucun modèle au catalogue"
            description="Ajoutez vos modèles avec leur prix et leur fiche technique : ils servent aux proformas et aux catalogues envoyés aux clients."
            action={canCreate ? { href: '/products/new', label: 'Ajouter un modèle' } : undefined}
          />
        </div>
      ) : view === 'grille' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => {
            const qty = Number(p.quantity_on_hand);
            const low = qty <= Number(p.stock_min);
            return (
              <Link key={p.id} href={`/products/${p.id}`} className="card card-hover block overflow-hidden">
                {p.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.photo_url} alt={p.designation} className="aspect-[16/10] w-full bg-[#F7F8FA] object-contain" loading="lazy" />
                ) : (
                  <div className="flex aspect-[16/10] w-full items-center justify-center bg-[#F7F8FA] text-xs text-gray-400">
                    Pas encore de photo
                  </div>
                )}
                <div className="border-t border-gray-100 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 text-sm font-semibold leading-5">{p.designation}</p>
                    {!p.is_active && <span className="badge-gray">Inactif</span>}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[13px]">
                    <span className="num font-medium">{formatCFA(Number(p.sale_price))}</span>
                    <span className={low ? 'font-medium text-kf-red' : 'text-gray-500'}>
                      {qty} en stock{low ? ', seuil atteint' : ''}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Modèle</th>
                <th className="hidden sm:table-cell">Référence</th>
                <th className="num">Prix</th>
                <th className="num">Stock</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const qty = Number(p.quantity_on_hand);
                const low = qty <= Number(p.stock_min);
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/products/${p.id}`} className="flex items-center gap-3 hover:text-kf-navy">
                        {p.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.photo_url} alt="" className="h-9 w-14 shrink-0 rounded bg-[#F7F8FA] object-contain" loading="lazy" />
                        ) : (
                          <span className="h-9 w-14 shrink-0 rounded bg-[#F7F8FA]" />
                        )}
                        <span className="font-medium">{p.designation}</span>
                        {!p.is_active && <span className="badge-gray">Inactif</span>}
                      </Link>
                    </td>
                    <td className="hidden text-gray-500 sm:table-cell">{p.sku || '-'}</td>
                    <td className="num whitespace-nowrap font-medium">{formatCFA(Number(p.sale_price))}</td>
                    <td className={`num ${low ? 'font-medium text-kf-red' : ''}`}>{qty}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
