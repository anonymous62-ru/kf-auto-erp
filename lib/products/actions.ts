'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function createProduct(input: {
  designation: string;
  sku?: string;
  salePrice: number;
  taxRate: number;
  quantityOnHand?: number;
  stockMin?: number;
}) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifie');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile) throw new Error('Profil introuvable');

  if (!input.designation.trim()) throw new Error('La désignation est obligatoire');

  const { error } = await supabase.from('products').insert({
    organization_id: profile.organization_id,
    designation: input.designation,
    sku: input.sku || null,
    sale_price: input.salePrice,
    tax_rate: input.taxRate,
    quantity_on_hand: input.quantityOnHand ?? 0,
    stock_min: input.stockMin ?? 0,
    is_active: true,
  });
  if (error) throw new Error(error.message);

  revalidatePath('/products');
}

export async function getProducts() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('products')
    .select('id, designation, sku, brand, model, sale_price, tax_rate, quantity_on_hand, stock_min, is_active, photo_url')
    // Produits archivés (supprimés mais encore cités dans d'anciens documents) : masqués.
    .or('is_archived.is.null,is_archived.eq.false')
    .order('designation');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getProduct(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('products')
    .select(
      'id, designation, sku, reference, brand, model, description, short_specs, sale_price, tax_rate, quantity_on_hand, stock_min, is_active'
    )
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateProduct(input: {
  id: string;
  designation: string;
  sku?: string;
  brand?: string;
  model?: string;
  description?: string;
  // Caractéristiques courtes imprimées sur la facture (migration 0050).
  shortSpecs?: string;
  salePrice: number;
  taxRate: number;
  stockMin?: number;
  isActive: boolean;
}) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifie');

  if (!input.designation.trim()) throw new Error('La désignation est obligatoire');

  const { error } = await supabase
    .from('products')
    .update({
      designation: input.designation,
      sku: input.sku || null,
      brand: input.brand || null,
      model: input.model || null,
      description: input.description || null,
      short_specs: input.shortSpecs?.trim() || null,
      sale_price: input.salePrice,
      tax_rate: input.taxRate,
      stock_min: input.stockMin ?? 0,
      is_active: input.isActive,
    })
    .eq('id', input.id);
  if (error) throw new Error(error.message);

  revalidatePath('/products');
  revalidatePath(`/products/${input.id}`);
}

// Ajustement manuel du compteur d'un article. Refusé pour un modèle suivi
// par numéro de châssis : son stock se calcule à partir des véhicules
// enregistrés (Stock véhicules), un ajustement à la main serait écrasé.
// Renvoie { error } pour que le vrai message s'affiche aussi en production.
export async function adjustStock(input: { productId: string; quantity: number; reason?: string }): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: 'Session expirée, reconnectez-vous.' };
  if (!Number.isFinite(input.quantity) || input.quantity === 0) return { error: 'Quantité invalide.' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (!profile) return { error: 'Profil introuvable.' };

  const { count: unitCount } = await supabase
    .from('vehicle_units')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', input.productId);
  if ((unitCount ?? 0) > 0) {
    return { error: 'Ce modèle est suivi par numéro de châssis : ajoutez ou modifiez les véhicules dans Stock véhicules.' };
  }

  const { data: product } = await supabase
    .from('products')
    .select('quantity_on_hand')
    .eq('id', input.productId)
    .single();
  const newQty = Number(product?.quantity_on_hand ?? 0) + input.quantity;
  if (newQty < 0) return { error: 'Le stock ne peut pas devenir négatif.' };

  const { error: moveError } = await supabase.from('stock_movements').insert({
    organization_id: profile.organization_id,
    product_id: input.productId,
    movement_type: input.quantity >= 0 ? 'entree' : 'sortie',
    quantity: input.quantity,
    reason: input.reason,
    performed_by: userData.user.id,
  });
  if (moveError) {
    return { error: /row-level security/i.test(moveError.message) ? "Vous n'avez pas le droit de modifier le stock." : moveError.message };
  }

  const { data: updated, error: updateError } = await supabase
    .from('products')
    .update({ quantity_on_hand: newQty })
    .eq('id', input.productId)
    .select('id');
  if (updateError) return { error: updateError.message };
  if (!updated || updated.length === 0) return { error: "Vous n'avez pas le droit de modifier le stock." };

  revalidatePath('/products');
  revalidatePath(`/products/${input.productId}`);
  return {};
}

// Suppression d'un produit (fonction SQL delete_product_secure, migration
// 0023). Un produit déjà présent dans un devis, une facture, un contrat ou
// une garantie n'est pas effacé mais archivé (retiré du catalogue), pour ne
// pas casser ces documents. Renvoie un résultat plutôt que de lever une
// erreur, pour que le vrai message s'affiche aussi en production.
export async function deleteProduct(productId: string): Promise<{ ok: true; archived: boolean } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('delete_product_secure', { p_product_id: productId });
  if (error) {
    if (error.message.includes('delete_product_secure')) {
      return { ok: false, error: "La fonction de suppression n'est pas encore installée dans la base (migration 0023 à exécuter dans Supabase)." };
    }
    return { ok: false, error: error.message };
  }
  revalidatePath('/products');
  return { ok: true, archived: data === 'archived' };
}
