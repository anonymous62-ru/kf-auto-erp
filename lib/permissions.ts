// Rôles autorisés par action, alignés sur les policies RLS de la base
// (migrations 0016, 0017, 0028, 0032). Sert uniquement à ne pas afficher un
// bouton ou un formulaire qui échouerait : la base refuse de toute façon.
import { createClient } from '@/lib/supabase/server';

export const CAN = {
  productWrite: ['super_admin', 'administrateur', 'manager', 'responsable_showroom'],
  partWrite: ['super_admin', 'administrateur', 'manager', 'magasinier', 'chef_atelier', 'responsable_showroom'],
  repairOrderCreate: ['super_admin', 'administrateur', 'manager', 'receptionniste_sav', 'chef_atelier', 'responsable_showroom'],
  appointmentWrite: ['super_admin', 'administrateur', 'manager', 'commercial', 'receptionniste_sav', 'chef_atelier', 'responsable_showroom'],
  warrantyWrite: ['super_admin', 'administrateur', 'manager', 'receptionniste_sav', 'chef_atelier', 'comptable', 'responsable_showroom'],
  // Circuit de vente (09/10) : seule l'administration des ventes facture.
  // Stock véhicules par châssis (migration 0033).
  vehicleUnitWrite: ['super_admin', 'administrateur', 'manager', 'responsable_showroom', 'admin_ventes'],
  invoice: ['super_admin', 'administrateur', 'manager', 'admin_ventes'],
  teamSales: ['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes', 'commercial', 'chef_service'],
  validateUserRequests: ['super_admin', 'administrateur', 'manager'],
  directClient: ['super_admin', 'administrateur', 'manager', 'admin_ventes', 'comptable', 'receptionniste_sav', 'chef_atelier'],
} as const;

export type Permission = keyof typeof CAN;

export async function getCurrentRole(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  return (data?.role as string | undefined) ?? null;
}

export async function getCurrentProfile(): Promise<{ id: string; role: string; department: string | null } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('role, department').eq('id', user.id).maybeSingle();
  if (!data) return null;
  return { id: user.id, role: data.role as string, department: (data.department as string | null) ?? null };
}

export function can(role: string | null, permission: Permission) {
  return !!role && (CAN[permission] as readonly string[]).includes(role);
}
