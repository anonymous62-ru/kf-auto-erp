'use server';

// Stock véhicules par numéro de châssis (migration 0033). Les fonctions
// renvoient { error } plutôt que de lever une erreur : en production,
// Next.js masque le message des erreurs levées dans une Server Action.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { MANUAL_STATUSES, type VehicleStatus } from '@/lib/stock/labels';
import { getCurrentRole } from '@/lib/permissions';
import { DIRECTION_ROLES } from '@/lib/users/roles';

export type VehicleUnitRow = {
  id: string;
  product_id: string;
  model: string;
  vin: string;
  color: string | null;
  model_year: number | null;
  entry_date: string;
  status: VehicleStatus;
  location: string | null;
  notes: string | null;
  status_changed_at: string;
  sold_at: string | null;
  document_id: string | null;
  document_type: string | null;
  document_number: string | null;
  commercial_name: string | null;
};

export async function listVehicleUnits(): Promise<{ units: VehicleUnitRow[]; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('list_vehicle_units');
  if (error) {
    if (/list_vehicle_units/.test(error.message)) {
      return { units: [], error: "Le stock par châssis n'est pas encore installé dans la base (migration 0033)." };
    }
    return { units: [], error: error.message };
  }
  return { units: (data ?? []) as VehicleUnitRow[] };
}

function friendly(message: string) {
  if (/vehicle_units_org_vin_uidx|duplicate key/i.test(message)) return 'Ce numéro de châssis existe déjà dans le stock.';
  if (/row-level security/i.test(message)) return "Vous n'avez pas le droit de modifier le stock véhicules.";
  return message;
}

export interface AddVehicleUnitsInput {
  productId: string;
  vins: string[];
  entryDate: string;
  color?: string;
  modelYear?: number | null;
  location?: string;
}

// Entrée en stock d'un ou plusieurs véhicules d'un même modèle (un numéro de
// châssis par ligne). Les doublons sont signalés sans bloquer les autres.
export async function addVehicleUnits(
  input: AddVehicleUnitsInput
): Promise<{ inserted: number; duplicates: string[]; error?: string }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { inserted: 0, duplicates: [], error: 'Session expirée, reconnectez-vous.' };
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (!profile) return { inserted: 0, duplicates: [], error: 'Profil introuvable.' };

  const vins = Array.from(
    new Set(input.vins.map((v) => v.trim().toUpperCase().replace(/\s+/g, '')).filter(Boolean))
  );
  if (!input.productId) return { inserted: 0, duplicates: [], error: 'Choisissez le modèle.' };
  if (vins.length === 0) return { inserted: 0, duplicates: [], error: 'Saisissez au moins un numéro de châssis.' };
  if (vins.length > 200) return { inserted: 0, duplicates: [], error: '200 véhicules au maximum par saisie.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate)) return { inserted: 0, duplicates: [], error: "Date d'entrée invalide." };
  if (input.entryDate > new Date().toISOString().slice(0, 10)) {
    return { inserted: 0, duplicates: [], error: "La date d'entrée ne peut pas être dans le futur." };
  }

  const { data: existing } = await supabase.from('vehicle_units').select('vin').in('vin', vins);
  const taken = new Set<string>((existing ?? []).map((e: { vin: string }) => e.vin.toUpperCase()));
  const fresh = vins.filter((v) => !taken.has(v));

  if (fresh.length > 0) {
    const { error } = await supabase.from('vehicle_units').insert(
      fresh.map((vin) => ({
        organization_id: profile.organization_id,
        product_id: input.productId,
        vin,
        entry_date: input.entryDate,
        color: input.color?.trim() || null,
        model_year: input.modelYear || null,
        location: input.location?.trim() || null,
      }))
    );
    if (error) return { inserted: 0, duplicates: Array.from(taken), error: friendly(error.message) };
  }

  revalidatePath('/stock');
  revalidatePath('/products');
  revalidatePath(`/products/${input.productId}`);
  return { inserted: fresh.length, duplicates: Array.from(taken) };
}

export interface UpdateVehicleUnitInput {
  id: string;
  vin: string;
  color?: string;
  modelYear?: number | null;
  entryDate: string;
  location?: string;
  notes?: string;
  status?: VehicleStatus;
}

export async function updateVehicleUnit(input: UpdateVehicleUnitInput): Promise<{ error?: string }> {
  const supabase = await createClient();
  if (!input.vin.trim()) return { error: 'Le numéro de châssis est obligatoire.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate)) return { error: "Date d'entrée invalide." };

  const update: Record<string, unknown> = {
    vin: input.vin.trim().toUpperCase().replace(/\s+/g, ''),
    color: input.color?.trim() || null,
    model_year: input.modelYear || null,
    entry_date: input.entryDate,
    location: input.location?.trim() || null,
    notes: input.notes?.trim() || null,
  };
  if (input.status) update.status = input.status;

  const { data, error } = await supabase.from('vehicle_units').update(update).eq('id', input.id).select('id');
  if (error) return { error: friendly(error.message) };
  if (!data || data.length === 0) return { error: "Vous n'avez pas le droit de modifier ce véhicule." };

  revalidatePath('/stock');
  revalidatePath(`/stock/${input.id}`);
  return {};
}

// Changement rapide de statut (boutons de la fiche véhicule).
// La base refuse de toute façon les statuts "réservé"/"vendu" hors direction.
export async function setVehicleStatus(id: string, status: VehicleStatus): Promise<{ error?: string }> {
  const role = await getCurrentRole();
  if (!DIRECTION_ROLES.includes(role ?? '') && !MANUAL_STATUSES.includes(status)) {
    return { error: 'Ce statut suit les paiements de la facture.' };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from('vehicle_units').update({ status }).eq('id', id).select('id');
  if (error) return { error: friendly(error.message) };
  if (!data || data.length === 0) return { error: "Vous n'avez pas le droit de modifier ce véhicule." };
  revalidatePath('/stock');
  revalidatePath(`/stock/${id}`);
  return {};
}

// Choix des numéros de châssis d'une ligne de commande ou de facture.
export async function setItemVehicles(itemId: string, unitIds: string[], documentId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_item_vehicles', { p_item_id: itemId, p_unit_ids: unitIds });
  if (error) return { error: error.message };
  revalidatePath(`/documents/${documentId}`);
  revalidatePath('/stock');
  return {};
}
