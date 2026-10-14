'use server';

// Agenda des commerciaux : événements saisis ici + rendez-vous et relances
// des leads (fonction get_agenda, migration 0034).

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { EventStatus, EventType } from '@/lib/crm/labels';

export type AgendaItem = {
  source: 'agenda' | 'rdv_lead' | 'relance_lead';
  id: string;
  event_type: EventType;
  title: string;
  starts_at: string;
  ends_at: string | null;
  status: EventStatus;
  location: string | null;
  notes: string | null;
  owner_id: string | null;
  owner_name: string | null;
  lead_id: string | null;
  client_id: string | null;
  deal_id: string | null;
  contact_name: string | null;
};

export async function getAgenda(from: string, to: string, userId?: string | null): Promise<{ items: AgendaItem[]; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_agenda', { p_from: from, p_to: to, p_user: userId || null });
  if (error) {
    if (/get_agenda/.test(error.message)) return { items: [], error: "L'agenda n'est pas encore installé dans la base (migration 0034)." };
    return { items: [], error: error.message };
  }
  return { items: (data ?? []) as AgendaItem[] };
}

export interface EventInput {
  eventType: EventType;
  title: string;
  startsAt: string; // ISO
  endsAt?: string | null;
  location?: string;
  notes?: string;
  assignedTo?: string | null;
  leadId?: string | null;
  clientId?: string | null;
  dealId?: string | null;
}

export async function createEvent(input: EventInput): Promise<{ error?: string }> {
  if (!input.title.trim()) return { error: 'Donnez un titre à l’événement.' };
  if (!input.startsAt || Number.isNaN(Date.parse(input.startsAt))) return { error: 'Date et heure obligatoires.' };
  if (input.endsAt && Date.parse(input.endsAt) < Date.parse(input.startsAt)) return { error: 'La fin est avant le début.' };

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: 'Session expirée, reconnectez-vous.' };
  const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', userData.user.id).maybeSingle();
  if (!profile) return { error: 'Profil introuvable.' };

  const { error } = await supabase.from('agenda_events').insert({
    organization_id: profile.organization_id,
    assigned_to: input.assignedTo || userData.user.id,
    event_type: input.eventType,
    title: input.title.trim(),
    starts_at: input.startsAt,
    ends_at: input.endsAt || null,
    location: input.location?.trim() || null,
    notes: input.notes?.trim() || null,
    lead_id: input.leadId || null,
    client_id: input.clientId || null,
    deal_id: input.dealId || null,
  });
  if (error) return { error: /row-level security/i.test(error.message) ? "Vous ne pouvez planifier que dans votre propre agenda." : error.message };
  revalidatePath('/agenda');
  if (input.dealId) revalidatePath(`/affaires/${input.dealId}`);
  return {};
}

export async function setEventStatus(id: string, status: EventStatus): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('agenda_events').update({ status }).eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'Événement introuvable ou non modifiable.' };
  revalidatePath('/agenda');
  return {};
}

export async function removeEvent(id: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('agenda_events').delete().eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'Événement introuvable ou non modifiable.' };
  revalidatePath('/agenda');
  return {};
}
