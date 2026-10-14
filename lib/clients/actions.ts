'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { applyClientSearch } from '@/lib/search';

export interface CreateClientInput {
  clientType: 'particulier' | 'entreprise';
  firstName?: string;
  lastName?: string;
  companyName?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  address?: string;
  city?: string;
  notes?: string;
  // "client" : contact déjà acheteur (par exemple reçu à l'atelier). Réservé
  // aux rôles de DIRECT_CLIENT_ROLES ; la base refuse pour les autres, qui
  // voient leurs prospects devenir clients au premier versement.
  status?: 'prospect' | 'client';
}

export async function createClientFull(input: CreateClientInput) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifié');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile) throw new Error('Profil introuvable');

  if (!input.companyName?.trim() && !input.lastName?.trim() && !input.phone?.trim()) {
    throw new Error('Renseignez au moins un nom, une société ou un téléphone.');
  }

  const { data: client, error } = await supabase
    .from('clients')
    .insert({
      organization_id: profile.organization_id,
      assigned_to: userData.user.id,
      created_by: userData.user.id,
      client_type: input.clientType,
      first_name: input.firstName || null,
      last_name: input.lastName || null,
      company_name: input.companyName || null,
      phone: input.phone || null,
      whatsapp: input.whatsapp || null,
      email: input.email || null,
      address: input.address || null,
      city: input.city || null,
      notes: input.notes || null,
      status: input.status === 'client' ? 'client' : 'prospect',
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  redirect(`/clients/${client.id}`);
}

export async function getClientFull(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('clients')
    .select(
      'id, client_type, first_name, last_name, company_name, phone, whatsapp, email, address, city, notes, status, client_number'
    )
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export interface UpdateClientInput extends CreateClientInput {
  id: string;
}

export async function updateClientFull(input: UpdateClientInput) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifié');

  if (!input.companyName?.trim() && !input.lastName?.trim() && !input.phone?.trim()) {
    throw new Error('Renseignez au moins un nom, une société ou un téléphone.');
  }

  const { error } = await supabase
    .from('clients')
    .update({
      client_type: input.clientType,
      first_name: input.firstName || null,
      last_name: input.lastName || null,
      company_name: input.companyName || null,
      phone: input.phone || null,
      whatsapp: input.whatsapp || null,
      email: input.email || null,
      address: input.address || null,
      city: input.city || null,
      notes: input.notes || null,
    })
    .eq('id', input.id);
  if (error) throw new Error(error.message);

  revalidatePath(`/clients/${input.id}`);
  revalidatePath('/clients');
}

export async function searchClientsFull(query: string, status?: 'prospect' | 'client', assignedTo?: string) {
  const supabase = await createClient();
  let request = supabase
    .from('clients')
    .select('id, first_name, last_name, company_name, phone, city, status, client_number')
    .order('created_at', { ascending: false })
    .limit(50);
  if (status) request = request.eq('status', status);
  if (assignedTo) request = request.eq('assigned_to', assignedTo);

  request = applyClientSearch(request, query);
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data ?? [];
}
