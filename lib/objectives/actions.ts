'use server';

// Écriture des objectifs commerciaux. La RLS de sales_objectives (migration
// 0048) n'autorise l'écriture qu'à la direction et au responsable commercial ;
// les contrôles ci-dessous servent seulement à renvoyer un message clair.
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type ObjectiveInput = {
  id?: string | null;
  userId: string;
  periodStart: string;
  periodEnd: string;
  productId: string | null;
  targetUnits: number;
  notes?: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function friendly(message: string, code?: string) {
  if (code === '23505' || /sales_objectives_uniq/.test(message)) {
    return 'Un objectif existe déjà pour ce commercial, cette période et ce modèle : modifiez-le plutôt.';
  }
  if (code === '42501' || /row-level security/i.test(message)) {
    return 'Seuls la direction et le responsable commercial fixent les objectifs.';
  }
  return message;
}

export async function saveObjective(input: ObjectiveInput): Promise<{ error?: string; id?: string }> {
  if (!UUID.test(input.userId)) return { error: 'Choisissez un commercial.' };
  if (!DATE.test(input.periodStart) || !DATE.test(input.periodEnd)) return { error: 'Indiquez les dates de la période.' };
  if (input.periodEnd < input.periodStart) return { error: 'La fin de la période précède son début.' };
  const days = (Date.parse(input.periodEnd) - Date.parse(input.periodStart)) / 86_400_000;
  if (days > 366) return { error: 'Une période ne peut pas dépasser un an.' };
  if (input.productId && !UUID.test(input.productId)) return { error: 'Modèle invalide.' };
  const units = Math.round(Number(input.targetUnits));
  if (!Number.isFinite(units) || units < 1 || units > 10000) return { error: 'Indiquez un nombre de véhicules (au moins 1).' };
  const notes = (input.notes ?? '').trim().slice(0, 500) || null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Session expirée, reconnectez-vous.' };
  const { data: me } = await supabase.from('profiles').select('organization_id').eq('id', user.id).maybeSingle();
  if (!me?.organization_id) return { error: 'Profil introuvable.' };

  const row = {
    user_id: input.userId,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    product_id: input.productId || null,
    target_units: units,
    notes,
  };

  if (input.id) {
    if (!UUID.test(input.id)) return { error: 'Objectif introuvable.' };
    const { data, error } = await supabase.from('sales_objectives').update(row).eq('id', input.id).select('id');
    if (error) return { error: friendly(error.message, error.code) };
    if (!data || data.length === 0) return { error: "Modification refusée ou objectif supprimé entre-temps." };
    revalidatePath('/objectifs');
    revalidatePath('/dashboard');
    return { id: input.id };
  }

  const { data, error } = await supabase
    .from('sales_objectives')
    .insert({ ...row, organization_id: me.organization_id })
    .select('id')
    .single();
  if (error) return { error: friendly(error.message, error.code) };
  revalidatePath('/objectifs');
  revalidatePath('/dashboard');
  return { id: data.id as string };
}

export async function deleteObjective(id: string): Promise<{ error?: string }> {
  if (!UUID.test(id)) return { error: 'Objectif introuvable.' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('sales_objectives').delete().eq('id', id).select('id');
  if (error) return { error: friendly(error.message, error.code) };
  if (!data || data.length === 0) return { error: 'Suppression refusée ou objectif déjà supprimé.' };
  revalidatePath('/objectifs');
  revalidatePath('/dashboard');
  return {};
}
