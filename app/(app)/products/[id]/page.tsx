import { getProduct } from '@/lib/products/actions';
import { getProductPhotos } from '@/lib/products/gallery-actions';
import { ProductEditForm } from '@/components/products/product-edit-form';
import { StockAdjustment } from '@/components/products/stock-adjustment';
import { PhotoGallery } from '@/components/products/photo-gallery';
import { VehicleWhatsappShare } from '@/components/products/vehicle-whatsapp-share';
import Link from 'next/link';
import { IconChevronRight } from '@/components/icons';

export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(id);
  const photos = await getProductPhotos(id);

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

      <PhotoGallery productId={product.id} initialPhotos={photos} />

      <a
        href={`/api/products/${product.id}/pdf`}
        target="_blank"
        className="block text-center border border-kf-navy text-kf-navy rounded-md py-2.5 text-sm font-medium"
      >
        Voir la fiche véhicule (PDF)
      </a>

      <a
        href={`/contracts/new?productId=${product.id}`}
        className="block text-center bg-kf-orange text-white rounded-md py-2.5 text-sm font-medium"
      >
        Créer un contrat de vente
      </a>

      <VehicleWhatsappShare
        productId={product.id}
        designation={product.designation}
        brand={product.brand}
        model={product.model}
        salePrice={Number(product.sale_price)}
        photoUrls={photos.map((p) => p.url)}
      />
    </div>
  );
}
