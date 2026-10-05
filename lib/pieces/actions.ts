'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { searchTerms } from '@/lib/search';

async function getProfile() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifie');
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile) throw new Error('Profil introuvable');
  return { supabase, userId: userData.user.id, ...profile };
}

// ---------- Pièces ----------
export async function getParts(query?: string) {
  const supabase = await createClient();
  let request = supabase
    .from('parts')
    .select(
      'id, reference, designation, brand, sale_price, tax_rate, quantity_on_hand, quantity_reserved, stock_min, is_active'
    )
    .order('designation');

  if (query?.trim()) {
    // Mots nettoyés (voir lib/search.ts) : chaque mot doit apparaître dans la
    // désignation, la référence ou la marque.
    for (const term of searchTerms(query)) {
      request = request.or(`designation.ilike.%${term}%,reference.ilike.%${term}%,brand.ilike.%${term}%`);
    }
  }
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getPart(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('parts').select('*').eq('id', id).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function createPart(input: {
  reference: string;
  designation: string;
  brand?: string;
  compatibleModels?: string;
  supplierName?: string;
  location?: string;
  purchasePrice?: number;
  salePrice: number;
  taxRate?: number;
  quantityOnHand?: number;
  stockMin?: number;
}) {
  const { supabase, organization_id } = await getProfile();
  if (!input.reference.trim()) throw new Error('La référence est obligatoire');
  if (!input.designation.trim()) throw new Error('La désignation est obligatoire');

  const { error } = await supabase.from('parts').insert({
    organization_id,
    reference: input.reference,
    designation: input.designation,
    brand: input.brand || null,
    compatible_models: input.compatibleModels || null,
    supplier_name: input.supplierName || null,
    location: input.location || null,
    purchase_price: input.purchasePrice ?? 0,
    sale_price: input.salePrice,
    tax_rate: input.taxRate ?? 18,
    quantity_on_hand: input.quantityOnHand ?? 0,
    stock_min: input.stockMin ?? 0,
    is_active: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/pieces');
}

export async function updatePart(input: {
  id: string;
  reference: string;
  designation: string;
  brand?: string;
  compatibleModels?: string;
  supplierName?: string;
  location?: string;
  purchasePrice?: number;
  salePrice: number;
  taxRate?: number;
  stockMin?: number;
}) {
  // Note : la disponibilité (is_active) n'est volontairement PAS modifiable ici.
  // Depuis la demande du DG (04/10, import des pièces commandées en Chine sans
  // prix de vente), seule la fonction setPartAvailability ci-dessous — réservée
  // au Super Admin — peut activer/désactiver une pièce à la vente.
  const { supabase } = await getProfile();
  const { error } = await supabase
    .from('parts')
    .update({
      reference: input.reference,
      designation: input.designation,
      brand: input.brand || null,
      compatible_models: input.compatibleModels || null,
      supplier_name: input.supplierName || null,
      location: input.location || null,
      purchase_price: input.purchasePrice ?? 0,
      sale_price: input.salePrice,
      tax_rate: input.taxRate ?? 18,
      stock_min: input.stockMin ?? 0,
    })
    .eq('id', input.id);
  if (error) throw new Error(error.message);
  revalidatePath('/pieces');
  revalidatePath(`/pieces/${input.id}`);
}

// Le "crochet" demandé par le DG (04/10) : les pièces commandées en Chine sont
// importées avec is_active = false (prix de vente pas encore fixé). Seul le
// Super Admin peut les rendre disponibles à la vente, une fois les prix de
// vente locaux saisis sur la fiche de la pièce.
export async function setPartAvailability(partId: string, isActive: boolean) {
  const { supabase, role } = await getProfile();
  if (role !== 'super_admin') {
    throw new Error('Seul le Super Admin peut activer ou désactiver la disponibilité d’une pièce.');
  }
  const { error } = await supabase.from('parts').update({ is_active: isActive }).eq('id', partId);
  if (error) throw new Error(error.message);
  revalidatePath('/pieces');
  revalidatePath(`/pieces/${partId}`);
}

// ---------- Mouvements de stock (entrée réception / sortie manuelle / inventaire) ----------
export async function adjustPartStock(input: { partId: string; quantity: number; reason?: string }) {
  const { supabase, organization_id, userId } = await getProfile();

  const { error: moveError } = await supabase.from('parts_stock_movements').insert({
    organization_id,
    part_id: input.partId,
    movement_type: input.quantity >= 0 ? 'entree' : 'sortie',
    quantity: input.quantity,
    reason: input.reason,
    performed_by: userId,
  });
  if (moveError) throw new Error(moveError.message);

  const { data: part } = await supabase.from('parts').select('quantity_on_hand').eq('id', input.partId).single();
  const newQty = Number(part?.quantity_on_hand ?? 0) + input.quantity;

  const { error: updateError } = await supabase.from('parts').update({ quantity_on_hand: newQty }).eq('id', input.partId);
  if (updateError) throw new Error(updateError.message);

  revalidatePath('/pieces');
  revalidatePath(`/pieces/${input.partId}`);
}

export async function getPartOptions() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('parts')
    .select('id, reference, designation, sale_price, quantity_on_hand, quantity_reserved')
    .eq('is_active', true)
    .order('designation')
    .limit(300);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function searchPartsForOrder(query: string) {
  const supabase = await createClient();
  let request = supabase
    .from('parts')
    .select('id, reference, designation, sale_price, tax_rate, quantity_on_hand, quantity_reserved')
    .eq('is_active', true)
    .order('designation')
    .limit(15);
  if (query.trim()) request = request.ilike('designation', `%${query}%`);
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getPartStockHistory(partId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('parts_stock_movements')
    .select('id, movement_type, quantity, reason, created_at')
    .eq('part_id', partId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}
