import { getProducts } from '@/lib/products/actions';
import { formatCFA } from '@/lib/documents/calculations';
import Link from 'next/link';
import { IconPlus, IconAlert } from '@/components/icons';

export default async function ProductsPage() {
  const products = await getProducts();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Produits</h1>
        <Link href="/products/new" className="btn-primary text-sm px-3 py-1.5">
          <IconPlus className="w-3.5 h-3.5" /> Nouveau produit
        </Link>
      </div>

      {products.length === 0 && (
        <div className="card p-4 text-sm text-gray-500">
          Aucun produit dans le catalogue pour le moment. Les véhicules du catalogue (Tiggo 2 Pro, Tiggo 4, Tiggo
          7, Tiggo 9, Pick-up Himla) apparaissent ici une fois la migration correspondante exécutée côté Supabase.
        </div>
      )}

      <div className="space-y-2">
        {products.map((p) => {
          const qty = Number(p.quantity_on_hand);
          const min = Number(p.stock_min);
          const low = qty <= min;
          const subtitle = [p.sku || 'Sans SKU', [p.brand, p.model].filter(Boolean).join(' ')]
            .filter(Boolean)
            .join(' · ');
          return (
            <Link key={p.id} href={`/products/${p.id}`} className="card card-hover p-3 text-sm flex justify-between items-center gap-3">
              <div className="min-w-0">
                <p className="font-medium truncate">
                  {p.designation}
                  {!p.is_active && <span className="badge badge-gray ml-2 align-middle">Inactif</span>}
                </p>
                <p className="text-xs text-gray-500">{subtitle}</p>
                <p
                  className={`text-xs mt-1 flex items-center gap-1 ${low ? 'text-kf-red font-medium' : 'text-gray-500'}`}
                >
                  {low && <IconAlert className="w-3 h-3" />}
                  Stock : {qty} {low && '(faible)'}
                </p>
              </div>
              <p className="font-medium whitespace-nowrap">{formatCFA(Number(p.sale_price))}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
