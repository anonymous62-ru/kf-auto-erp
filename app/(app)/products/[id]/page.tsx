import { getProduct } from '@/lib/products/actions';
import { ProductEditForm } from '@/components/products/product-edit-form';
import { StockAdjustment } from '@/components/products/stock-adjustment';
import Link from 'next/link';
import { IconChevronRight } from '@/components/icons';

export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(id);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <Link href="/products" className="hover:text-kf-navy">
          Produits
        </Link>
        <IconChevronRight className="w-3 h-3" />
        <span className="text-gray-600">{product.designation}</span>
      </div>
      <h1 className="text-lg font-medium">Modifier le produit</h1>

      <StockAdjustment
        productId={product.id}
        designation={product.designation}
        quantityOnHand={Number(product.quantity_on_hand)}
        stockMin={Number(product.stock_min)}
      />

      <ProductEditForm product={product} />
    </div>
  );
}
