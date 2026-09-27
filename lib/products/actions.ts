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
    .select('id, designation, sku, brand, model, sale_price, tax_rate, quantity_on_hand, stock_min, is_active')
    .order('designation');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getProduct(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('products')
    .select(
      'id, designation, sku, reference, brand, model, description, sale_price, tax_rate, quantity_on_hand, stock_min, is_active'
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

export async function adjustStock(input: { productId: string; quantity: number; reason?: string }) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifie');

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (!profile) throw new Error('Profil introuvable');

  const { error: moveError } = await supabase.from('stock_movements').insert({
    organization_id: profile.organization_id,
    product_id: input.productId,
    movement_type: input.quantity >= 0 ? 'entree' : 'sortie',
    quantity: input.quantity,
    reason: input.reason,
    performed_by: userData.user.id,
  });
  if (moveError) throw new Error(moveError.message);

  const { data: product } = await supabase
    .from('products')
    .select('quantity_on_hand')
    .eq('id', input.productId)
    .single();

  const newQty = Number(product?.quantity_on_hand ?? 0) + input.quantity;

  const { error: updateError } = await supabase
    .from('products')
    .update({ quantity_on_hand: newQty })
    .eq('id', input.productId);
  if (updateError) throw new Error(updateError.message);

  revalidatePath('/products');
}
