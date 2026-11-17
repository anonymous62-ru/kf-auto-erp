// Lecture des objectifs commerciaux (en nombre de véhicules). Le réalisé est
// calculé par la base (RPC objectives_progress, migration 0048) à partir des
// factures émises ; la RPC filtre selon le rôle : un commercial ne reçoit que
// ses propres objectifs.
import { createClient } from '@/lib/supabase/server';

// Qui fixe les objectifs et voit ceux de toute l'équipe.
export const OBJECTIVE_MANAGER_ROLES = ['super_admin', 'administrateur', 'manager', 'responsable_commercial'];
// Postes de vente suivis (comme la page « Suivi des commerciaux »).
export const OBJECTIVE_SALES_ROLES = ['commercial', 'vendeur_showroom', 'responsable_showroom'];

export function canManageObjectives(role: string | null | undefined) {
  return !!role && OBJECTIVE_MANAGER_ROLES.includes(role);
}

export type ObjectiveProgress = {
  objective_id: string;
  user_id: string;
  user_name: string;
  user_role: string | null;
  product_id: string | null;
  product_label: string | null;
  period_start: string;
  period_end: string;
  target_units: number;
  achieved_units: number;
  pct: number;
  notes: string | null;
};

export type SalesPerson = { id: string; full_name: string; role: string; is_active: boolean };
export type VehicleModel = { id: string; label: string };

export async function getObjectivesProgress(from: string, to: string): Promise<{ rows: ObjectiveProgress[]; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('objectives_progress', { p_from: from, p_to: to });
  if (error) return { rows: [], error: error.message };
  const rows = ((data ?? []) as ObjectiveProgress[]).map((r) => ({
    ...r,
    target_units: Number(r.target_units),
    achieved_units: Number(r.achieved_units),
    pct: Number(r.pct),
  }));
  return { rows };
}

export async function getSalesPeople(): Promise<SalesPerson[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, role, is_active')
    .in('role', OBJECTIVE_SALES_ROLES)
    .order('full_name');
  return ((data ?? []) as { id: string; full_name: string | null; role: string; is_active: boolean | null }[]).map((p) => ({
    id: p.id,
    full_name: p.full_name ?? '',
    role: p.role,
    is_active: p.is_active !== false,
  }));
}

export async function getVehicleModels(): Promise<VehicleModel[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('products')
    .select('id, designation, model, is_archived')
    .order('designation');
  return ((data ?? []) as { id: string; designation: string; model: string | null; is_archived: boolean | null }[])
    .filter((p) => !p.is_archived)
    .map((p) => ({ id: p.id, label: p.model || p.designation }));
}

export async function getMonthTotals(): Promise<{
  monthStart: string;
  orgTarget: number;
  orgAchieved: number;
  myTarget: number;
  myAchieved: number;
} | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('objectives_month_total');
  if (error || !data) return null;
  const d = data as Record<string, unknown>;
  return {
    monthStart: String(d.month_start ?? ''),
    orgTarget: Number(d.org_target ?? 0),
    orgAchieved: Number(d.org_achieved ?? 0),
    myTarget: Number(d.my_target ?? 0),
    myAchieved: Number(d.my_achieved ?? 0),
  };
}
