// Ajoute les numéros de châssis choisis (étape 2) à la désignation des lignes
// d'un document, pour le PDF : une facture de véhicule doit porter
// son numéro de châssis.
import type { SupabaseClient } from '@supabase/supabase-js';

export async function withVehicleNumbers<T extends { id: string; designation: string }>(
  supabase: SupabaseClient,
  documentId: string,
  items: T[]
): Promise<T[]> {
  if (items.length === 0) return items;
  const { data, error } = await supabase
    .from('document_item_vehicles')
    .select('document_item_id, vehicle_units (vin)')
    .eq('document_id', documentId)
    .is('removed_at', null);
  if (error || !data || data.length === 0) return items;

  const byItem = new Map<string, string[]>();
  for (const row of data as { document_item_id: string; vehicle_units: { vin: string } | { vin: string }[] | null }[]) {
    const unit = Array.isArray(row.vehicle_units) ? row.vehicle_units[0] : row.vehicle_units;
    if (!unit?.vin) continue;
    byItem.set(row.document_item_id, [...(byItem.get(row.document_item_id) ?? []), unit.vin]);
  }

  return items.map((item) => {
    const vins = byItem.get(item.id);
    if (!vins?.length) return item;
    return { ...item, designation: `${item.designation}\n- N° de châssis : ${vins.join(', ')}` };
  });
}
