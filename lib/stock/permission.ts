// Droit « modifier_stock » (migration 0054, réglable par rôle par le super
// admin). Sert à afficher les boutons du stock véhicules ; la base applique
// le même droit (policies de vehicle_units, migration 0057).
import { createClient } from '@/lib/supabase/server';

export async function canEditStock(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('has_permission', { p_permission: 'modifier_stock' });
  if (error) return false;
  return data === true;
}
