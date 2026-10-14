'use server';

// Campagnes marketing (étape 4). Renvoie { error } plutôt que de lever une
// erreur : en production, Next.js masque le message des erreurs levées.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type CampaignRow = {
  id: string;
  name: string;
  channel: string;
  start_date: string;
  end_date: string | null;
  budget: number;
  spent: number;
  objective: string | null;
  status: string;
  notes: string | null;
  stats: {
    leads: number;
    leads_converted: number;
    deals_open: number;
    deals_won: number;
    won_amount: number;
    invoiced_amount: number;
    catalogues_sent: number;
    catalogues_opened: number;
  } | null;
};

export async function listCampaigns(withStats: boolean): Promise<{ campaigns: CampaignRow[]; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, name, channel, start_date, end_date, budget, spent, objective, status, notes')
    .order('start_date', { ascending: false });
  if (error) {
    if (/campaigns/.test(error.message) && /exist|schema cache/i.test(error.message)) {
      return { campaigns: [], error: "Les campagnes ne sont pas encore installées dans la base (migration 0035)." };
    }
    return { campaigns: [], error: error.message };
  }
  const stats = new Map<string, CampaignRow['stats']>();
  if (withStats) {
    const [{ data: rows }, { data: catRows }] = await Promise.all([
      supabase.rpc('campaign_stats'),
      supabase.rpc('campaign_catalogue_stats'),
    ]);
    const cat = new Map(
      ((catRows ?? []) as Record<string, unknown>[]).map((r) => [r.campaign_id as string, { sent: Number(r.sent ?? 0), opened: Number(r.opened ?? 0) }])
    );
    for (const r of (rows ?? []) as Record<string, unknown>[]) {
      stats.set(r.campaign_id as string, {
        leads: Number(r.leads ?? 0),
        leads_converted: Number(r.leads_converted ?? 0),
        deals_open: Number(r.deals_open ?? 0),
        deals_won: Number(r.deals_won ?? 0),
        won_amount: Number(r.won_amount ?? 0),
        invoiced_amount: Number(r.invoiced_amount ?? 0),
        catalogues_sent: cat.get(r.campaign_id as string)?.sent ?? 0,
        catalogues_opened: cat.get(r.campaign_id as string)?.opened ?? 0,
      });
    }
  }
  return {
    campaigns: (data ?? []).map((c) => ({
      ...(c as Omit<CampaignRow, 'stats'>),
      budget: Number(c.budget ?? 0),
      spent: Number(c.spent ?? 0),
      stats: stats.get(c.id as string) ?? null,
    })),
  };
}

export interface CampaignInput {
  name: string;
  channel: string;
  startDate: string;
  endDate?: string | null;
  budget: number;
  spent: number;
  objective?: string;
  status: string;
  notes?: string;
}

function check(input: CampaignInput) {
  if (!input.name.trim()) return 'Le nom de la campagne est obligatoire.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return 'Date de début invalide.';
  if (input.endDate && input.endDate < input.startDate) return 'La fin est avant le début.';
  if (input.budget < 0 || input.spent < 0) return 'Montants invalides.';
  return null;
}

function row(input: CampaignInput) {
  return {
    name: input.name.trim(),
    channel: input.channel,
    start_date: input.startDate,
    end_date: input.endDate || null,
    budget: Math.round(input.budget),
    spent: Math.round(input.spent),
    objective: input.objective?.trim() || null,
    status: input.status,
    notes: input.notes?.trim() || null,
  };
}

export async function createCampaign(input: CampaignInput): Promise<{ error?: string }> {
  const err = check(input);
  if (err) return { error: err };
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: 'Session expirée, reconnectez-vous.' };
  const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', userData.user.id).maybeSingle();
  if (!profile) return { error: 'Profil introuvable.' };
  const { data, error } = await supabase
    .from('campaigns')
    .insert({ organization_id: profile.organization_id, ...row(input) })
    .select('id')
    .single();
  if (error) return { error: /row-level security/i.test(error.message) ? 'Réservé au marketing et à la direction.' : error.message };
  revalidatePath('/campagnes');
  redirect(`/campagnes/${data.id}`);
}

export async function updateCampaign(id: string, input: CampaignInput): Promise<{ error?: string }> {
  const err = check(input);
  if (err) return { error: err };
  const supabase = await createClient();
  const { data, error } = await supabase.from('campaigns').update(row(input)).eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'Réservé au marketing et à la direction.' };
  revalidatePath('/campagnes');
  revalidatePath(`/campagnes/${id}`);
  return {};
}
