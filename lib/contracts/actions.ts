'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

export interface CreateSaleContractInput {
  clientId: string;
  productId: string;
  salePrice: number;
  paymentTerms?: string;
  notes?: string;
}

// Génération automatique du contrat : dès que le commercial choisit un
// client + un véhicule, le contrat est créé avec son numéro officiel (même
// mécanisme que les devis/factures) — il ne reste plus qu'à le faire signer.
export async function createSaleContract(input: CreateSaleContractInput) {
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

  if (input.salePrice <= 0) throw new Error('Le prix de vente doit être positif');

  const year = new Date().getFullYear();
  const { data: contractNumber, error: numberError } = await supabase.rpc('get_next_contract_number', {
    p_organization_id: profile.organization_id,
    p_year: year,
  });
  if (numberError) throw new Error(numberError.message);

  const { data: contract, error } = await supabase
    .from('sale_contracts')
    .insert({
      organization_id: profile.organization_id,
      contract_number: contractNumber,
      client_id: input.clientId,
      product_id: input.productId,
      commercial_id: userData.user.id,
      sale_price: input.salePrice,
      payment_terms: input.paymentTerms || null,
      notes: input.notes || null,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  redirect(`/contracts/${contract.id}`);
}

export async function getSaleContracts() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sale_contracts')
    .select(
      `id, contract_number, sale_price, status, created_at, signed_at,
       clients (first_name, last_name, company_name),
       products (designation, brand, model)`
    )
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getSaleContract(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sale_contracts')
    .select(
      `id, contract_number, sale_price, payment_terms, notes, status, signed_at,
       commercial_signature_url, client_signature_url, created_at,
       client_id, product_id, commercial_id,
       clients (first_name, last_name, company_name, phone, email, address),
       products (designation, brand, model, reference, sku),
       profiles:commercial_id (full_name, phone)`
    )
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function cancelSaleContract(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from('sale_contracts').update({ status: 'annule' }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath(`/contracts/${id}`);
  revalidatePath('/contracts');
}
