import { getProduct } from '@/lib/products/actions';
import { createClient } from '@/lib/supabase/server';
import { ProductEditForm } from '@/components/products/product-edit-form';
import { StockAdjustment } from '@/components/products/stock-adjustment';
import { PhotoManager } from '@/components/catalogue/photo-manager';
import { OfficialPhotoImport } from '@/components/catalogue/official-import';
import { CatalogueTextsForm } from '@/components/catalogue/catalogue-texts-form';
import { SendCatalogueButton } from '@/components/catalogue/send-catalogue';
import { getCataloguePhotos, getCatalogueTexts, listCatalogueChoices } from '@/lib/catalogue/actions';
import { CATALOGUE_EDITOR_ROLES, CATALOGUE_SENDER_ROLES } from '@/lib/catalogue/roles';
import { DeleteProductButton } from '@/components/products/delete-product-button';
import Link from 'next/link';
import { IconChevronRight } from '@/components/icons';
import { can } from '@/lib/permissions';

export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(id);
  const [photos, texts, choices] = await Promise.all([getCataloguePhotos(id), getCatalogueTexts(id), listCatalogueChoices()]);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user?.id ?? '').maybeSingle();
  const canDelete = ['super_admin', 'administrateur', 'manager', 'responsable_showroom'].includes(me?.role ?? '');
  // Fiche, stock et photos modifiables seulement par les rôles autorisés
  // (avant : formulaire affiché à tous, enregistrement refusé en silence).
  const canEdit = can(me?.role ?? null, 'productWrite');
  // Catalogue (10/10) : photos et textes par l'administration et le
  // marketing ; envoi par les commerciaux, le showroom et le marketing.
  const canEditCatalogue = CATALOGUE_EDITOR_ROLES.includes(me?.role ?? '');
  const canSendCatalogue = CATALOGUE_SENDER_ROLES.includes(me?.role ?? '');

  // Modèle suivi par numéro de châssis (étape 2) : le stock se gère dans
  // "Stock véhicules", le compteur se calcule tout seul.
  const { data: units } = await supabase.from('vehicle_units').select('status').eq('product_id', id);
  const tracked = (units ?? []).length > 0;
  const unitCounts = (units ?? []).reduce(
    (acc: Record<string, number>, u: { status: string }) => ({ ...acc, [u.status]: (acc[u.status] ?? 0) + 1 }),
    {}
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <Link href="/products" className="hover:text-kf-navy">
          Produits
        </Link>
        <IconChevronRight className="w-3 h-3" />
        <span className="text-gray-600">{product.designation}</span>
      </div>
      <h1 className="page-title">{product.designation}</h1>
      {tracked && (
        <div className="card p-4 text-sm space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-500">En stock (par numéro de châssis)</span>
            <span className="font-medium">{Number(product.quantity_on_hand)}</span>
          </div>
          <p className="text-xs text-gray-500">
            {unitCounts.disponible ?? 0} disponible(s) · {unitCounts.reserve ?? 0} réservé(s) · {(unitCounts.demo ?? 0) + (unitCounts.essai ?? 0)}{' '}
            démo/essais · {unitCounts.endommage ?? 0} endommagé(s) · {unitCounts.vendu ?? 0} vendu(s)
          </p>
          <Link href={`/stock?modele=${product.id}`} className="btn-secondary w-full justify-center">
            Voir les véhicules de ce modèle
          </Link>
        </div>
      )}

      {!tracked && !canEdit && (
        <div className="card p-4 text-sm flex justify-between">
          <span className="text-gray-500">En stock</span>
          <span className="font-medium">{Number(product.quantity_on_hand)}</span>
        </div>
      )}

      {!tracked && canEdit && (
        <p className="text-xs text-gray-500">
          Pour suivre chaque véhicule (statut, ancienneté), enregistrez ses numéros de châssis dans{' '}
          <Link href={`/stock/new?modele=${product.id}`} className="text-kf-navy underline">
            Stock véhicules
          </Link>
          .
        </p>
      )}

      {!tracked && canEdit && (
      <StockAdjustment
        productId={product.id}
        designation={product.designation}
        quantityOnHand={Number(product.quantity_on_hand)}
        stockMin={Number(product.stock_min)}
      />
      )}

      {canEdit && <ProductEditForm product={product} />}

      <PhotoManager
        key={photos.map((p) => p.id).join(',')}
        productId={product.id}
        initialPhotos={photos}
        canEdit={canEditCatalogue}
      />
      {canEditCatalogue && <OfficialPhotoImport productId={product.id} />}
      <CatalogueTextsForm productId={product.id} initial={texts} canEdit={canEditCatalogue} />

      <div className="flex flex-col gap-2 sm:flex-row">
        {canSendCatalogue && <SendCatalogueButton choices={choices} preselected={[product.id]} />}
        <a href={`/api/catalogue/pdf?models=${product.id}`} target="_blank" className="btn-secondary justify-center">
          Aperçu de la fiche modèle (PDF)
        </a>
      </div>

      <a
        href={`/contracts/new?productId=${product.id}`}
        className="btn-secondary w-full justify-center"
      >
        Créer un contrat de vente
      </a>

      {canDelete && <DeleteProductButton productId={product.id} designation={product.designation} />}
    </div>
  );
}
