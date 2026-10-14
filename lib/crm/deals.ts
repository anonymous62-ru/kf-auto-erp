'use server';

// Affaires (opportunités de vente). Renvoie { error } plutôt que de lever
// une erreur : en production, Next.js masque le message des erreurs levées.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { DealStage, Temperature } from '@/lib/crm/labels';

export type DealRow = {
  id: string;
  title: string;
  assigned_to: string;
  lead_id: string | null;
  client_id: string | null;
  product_id: string | null;
  quantity: number;
  estimated_amount: number;
  temperature: Temperature;
  stage: DealStage;
  expected_close_date: string | null;
  document_id: string | null;
  lost_reason: string | null;
  notes: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  owner: { full_name: string | null } | null;
  client: { company_name: string | null; first_name: string | null; last_name: string | null; status: string | null } | null;
  lead: { company_name: string | null; first_name: string | null; last_name: string | null } | null;
  product: { designation: string } | null;
  document: { document_type: string; document_number: string | null; status: string } | null;
};

const SELECT = `id, title, assigned_to, lead_id, client_id, product_id, quantity, estimated_amount, temperature, stage,
  expected_close_date, document_id, lost_reason, notes, closed_at, created_at, updated_at,
  owner:profiles!deals_assigned_to_fkey(full_name),
  client:clients(company_name, first_name, last_name, status),
  lead:prospects(company_name, first_name, last_name),
  product:products(designation),
  document:documents(document_type, document_number, status)`;

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

function normalize(row: Record<string, unknown>): DealRow {
  return {
    ...(row as unknown as DealRow),
    estimated_amount: Number(row.estimated_amount ?? 0),
    owner: one(row.owner as DealRow['owner']),
    client: one(row.client as DealRow['client']),
    lead: one(row.lead as DealRow['lead']),
    product: one(row.product as DealRow['product']),
    document: one(row.document as DealRow['document']),
  };
}

export async function listDeals(): Promise<{ deals: DealRow[]; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('deals').select(SELECT).order('updated_at', { ascending: false }).limit(1000);
  if (error) {
    if (/deals/.test(error.message) && /exist|schema cache/i.test(error.message)) {
      return { deals: [], error: "Les affaires ne sont pas encore installées dans la base (migration 0034)." };
    }
    return { deals: [], error: error.message };
  }
  return { deals: (data ?? []).map((d) => normalize(d as Record<string, unknown>)) };
}

export async function getDeal(id: string): Promise<DealRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from('deals').select(SELECT).eq('id', id).maybeSingle();
  return data ? normalize(data as Record<string, unknown>) : null;
}

export interface DealInput {
  title: string;
  assignedTo?: string;
  leadId?: string | null;
  clientId?: string | null;
  productId?: string | null;
  quantity: number;
  estimatedAmount: number;
  temperature: Temperature;
  stage: DealStage;
  expectedCloseDate?: string | null;
  notes?: string;
}

function validate(input: DealInput) {
  if (!input.title.trim()) return 'Donnez un titre à l’affaire (ex. : Tiggo 7 pour M. Agbeko).';
  if (!input.leadId && !input.clientId) return 'Rattachez l’affaire à un lead ou à un contact.';
  if (!Number.isFinite(input.quantity) || input.quantity < 1) return 'La quantité doit être d’au moins 1.';
  if (!Number.isFinite(input.estimatedAmount) || input.estimatedAmount < 0) return 'Montant estimé invalide.';
  return null;
}

export async function createDeal(input: DealInput): Promise<{ error?: string }> {
  const err = validate(input);
  if (err) return { error: err };
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: 'Session expirée, reconnectez-vous.' };
  const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', userData.user.id).maybeSingle();
  if (!profile) return { error: 'Profil introuvable.' };

  const { data, error } = await supabase
    .from('deals')
    .insert({
      organization_id: profile.organization_id,
      assigned_to: input.assignedTo || userData.user.id,
      title: input.title.trim(),
      lead_id: input.leadId || null,
      client_id: input.clientId || null,
      product_id: input.productId || null,
      quantity: Math.round(input.quantity),
      estimated_amount: Math.round(input.estimatedAmount),
      temperature: input.temperature,
      stage: input.stage,
      expected_close_date: input.expectedCloseDate || null,
      notes: input.notes?.trim() || null,
    })
    .select('id')
    .single();
  if (error) return { error: /row-level security/i.test(error.message) ? "Vous ne pouvez créer d'affaire que pour vous-même." : error.message };
  revalidatePath('/affaires');
  redirect(`/affaires/${data.id}`);
}

export async function updateDeal(
  id: string,
  patch: Partial<DealInput> & { lostReason?: string | null; documentId?: string | null }
): Promise<{ error?: string }> {
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    if (!patch.title.trim()) return { error: 'Le titre est obligatoire.' };
    update.title = patch.title.trim();
  }
  if (patch.assignedTo !== undefined) update.assigned_to = patch.assignedTo;
  if (patch.productId !== undefined) update.product_id = patch.productId || null;
  if (patch.quantity !== undefined) update.quantity = Math.max(1, Math.round(patch.quantity));
  if (patch.estimatedAmount !== undefined) update.estimated_amount = Math.max(0, Math.round(patch.estimatedAmount));
  if (patch.temperature !== undefined) update.temperature = patch.temperature;
  if (patch.stage !== undefined) update.stage = patch.stage;
  if (patch.expectedCloseDate !== undefined) update.expected_close_date = patch.expectedCloseDate || null;
  if (patch.notes !== undefined) update.notes = patch.notes?.trim() || null;
  if (patch.lostReason !== undefined) update.lost_reason = patch.lostReason?.trim() || null;
  if (patch.documentId !== undefined) update.document_id = patch.documentId || null;
  if (patch.stage === 'perdue' && !patch.lostReason?.trim()) return { error: 'Indiquez pourquoi l’affaire est perdue.' };

  const supabase = await createClient();
  const { data, error } = await supabase.from('deals').update(update).eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Vous ne pouvez modifier que vos propres affaires." };
  revalidatePath('/affaires');
  revalidatePath(`/affaires/${id}`);
  return {};
}

export async function removeDeal(id: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('deals').delete().eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'Seule la direction peut supprimer une affaire.' };
  revalidatePath('/affaires');
  redirect('/affaires');
}

// Recherche d'un lead ou d'un contact pour rattacher une affaire (chacun ne
// trouve que ce que la base lui laisse voir).
export async function searchDealContacts(
  query: string
): Promise<{ kind: 'lead' | 'client'; id: string; name: string; phone: string | null; status?: string | null }[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const supabase = await createClient();
  const pattern = `%${q.replace(/[%_,()]/g, ' ')}%`;
  const [{ data: clients }, { data: leads }] = await Promise.all([
    supabase
      .from('clients')
      .select('id, company_name, first_name, last_name, phone, status')
      .or(`company_name.ilike.${pattern},last_name.ilike.${pattern},first_name.ilike.${pattern},phone.ilike.${pattern}`)
      .limit(10),
    supabase
      .from('prospects')
      .select('id, company_name, first_name, last_name, phone, client_id')
      .is('client_id', null)
      .or(`company_name.ilike.${pattern},last_name.ilike.${pattern},first_name.ilike.${pattern},phone.ilike.${pattern}`)
      .limit(10),
  ]);
  const name = (c: { company_name: string | null; first_name: string | null; last_name: string | null }) =>
    c.company_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Sans nom';
  return [
    ...(clients ?? []).map((c) => ({ kind: 'client' as const, id: c.id as string, name: name(c), phone: c.phone as string | null, status: c.status as string | null })),
    ...(leads ?? []).map((l) => ({ kind: 'lead' as const, id: l.id as string, name: name(l), phone: l.phone as string | null })),
  ];
}
