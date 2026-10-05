'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

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

function warrantyEndDate(startDate: string, durationMonths: number) {
  const d = new Date(startDate);
  d.setMonth(d.getMonth() + durationMonths);
  return d;
}

export async function getWarranties() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('vehicle_warranties')
    .select('id, vehicle_vin, brand, model, start_date, duration_months, mileage_limit, clients(first_name, last_name, company_name)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((w) => ({
    ...w,
    endDate: warrantyEndDate(w.start_date, w.duration_months),
  }));
}

export async function getWarranty(id: string) {
  const supabase = await createClient();
  const { data: warranty, error } = await supabase
    .from('vehicle_warranties')
    .select('*, clients(id, first_name, last_name, company_name, phone)')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);

  const { data: claims, error: claimsError } = await supabase
    .from('warranty_claims')
    .select('id, description, amount_requested, amount_covered, status, submitted_at, decided_at, repair_order_id')
    .eq('warranty_id', id)
    .order('submitted_at', { ascending: false });
  if (claimsError) throw new Error(claimsError.message);

  return { warranty, claims: claims ?? [], endDate: warrantyEndDate(warranty.start_date, warranty.duration_months) };
}

export async function createWarranty(input: {
  clientId?: string;
  productId?: string;
  vehicleVin: string;
  brand?: string;
  model?: string;
  startDate: string;
  durationMonths: number;
  mileageLimit?: number;
  coveredParts?: string;
}) {
  const { supabase, organization_id, userId } = await getProfile();
  if (!input.vehicleVin.trim()) throw new Error('Le VIN / N° de châssis est obligatoire');

  const { error } = await supabase.from('vehicle_warranties').insert({
    organization_id,
    client_id: input.clientId || null,
    product_id: input.productId || null,
    vehicle_vin: input.vehicleVin,
    brand: input.brand || null,
    model: input.model || null,
    start_date: input.startDate,
    duration_months: input.durationMonths,
    mileage_limit: input.mileageLimit ?? 100000,
    covered_parts: input.coveredParts || null,
    created_by: userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/garanties');
}

export async function createClaim(input: {
  warrantyId: string;
  repairOrderId?: string;
  description?: string;
  amountRequested: number;
}) {
  const { supabase, organization_id, userId } = await getProfile();

  const { data: claim, error } = await supabase
    .from('warranty_claims')
    .insert({
      organization_id,
      warranty_id: input.warrantyId,
      repair_order_id: input.repairOrderId || null,
      description: input.description || null,
      amount_requested: input.amountRequested,
      status: 'soumise',
      created_by: userId,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  if (input.repairOrderId) {
    await supabase
      .from('repair_orders')
      .update({ warranty_covered: true, warranty_claim_id: claim.id })
      .eq('id', input.repairOrderId);
  }

  revalidatePath(`/garanties/${input.warrantyId}`);
}

export async function updateClaimStatus(input: {
  claimId: string;
  warrantyId: string;
  status: 'soumise' | 'acceptee' | 'refusee' | 'remboursee';
  amountCovered?: number;
}) {
  const { supabase } = await getProfile();
  const { error } = await supabase
    .from('warranty_claims')
    .update({
      status: input.status,
      amount_covered: input.amountCovered,
      decided_at: ['acceptee', 'refusee', 'remboursee'].includes(input.status) ? new Date().toISOString() : null,
    })
    .eq('id', input.claimId);
  if (error) throw new Error(error.message);
  revalidatePath(`/garanties/${input.warrantyId}`);
}

export async function getVehicleModelOptions() {
  const supabase = await createClient();
  const { data, error } = await supabase.from('products').select('id, designation, brand, model').order('designation');
  if (error) throw new Error(error.message);
  return data ?? [];
}
