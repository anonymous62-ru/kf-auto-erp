// Rôles autorisés par action, alignés sur les policies RLS de la base
// (migrations 0016, 0017, 0028, 0032). Sert uniquement à ne pas afficher un
// bouton ou un formulaire qui échouerait : la base refuse de toute façon.
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { PermissionKey } from '@/lib/users/permission-catalog';

export const CAN = {
  productWrite: ['super_admin', 'administrateur', 'manager', 'responsable_showroom'],
  partWrite: ['super_admin', 'administrateur', 'manager', 'magasinier', 'chef_atelier', 'responsable_showroom'],
  repairOrderCreate: ['super_admin', 'administrateur', 'manager', 'receptionniste_sav', 'chef_atelier', 'responsable_showroom'],
  appointmentWrite: ['super_admin', 'administrateur', 'manager', 'commercial', 'receptionniste_sav', 'chef_atelier', 'responsable_showroom'],
  warrantyWrite: ['super_admin', 'administrateur', 'manager', 'receptionniste_sav', 'chef_atelier', 'comptable', 'responsable_showroom'],
  // Stock véhicules par châssis (migration 0033).
  vehicleUnitWrite: ['super_admin', 'administrateur', 'manager', 'responsable_showroom', 'admin_ventes'],
  teamSales: ['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes', 'commercial', 'chef_service', 'responsable_commercial'],
  // Circuit de vente : les actions (valider une proforma, vérifier un bon de
  // commande, préparer, valider, émettre une facture) suivent la matrice des
  // droits : voir getMyPermissions plus bas (migration 0058).
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

// ---------- Matrice des droits (migrations 0054 et 0058) ----------
// Le super admin coche ou décoche des droits par rôle ; la base applique la
// matrice (has_permission). Ces fonctions servent à afficher les bons boutons.

// Un droit de l'utilisateur connecté.
export async function hasPermission(key: PermissionKey): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('has_permission', { p_permission: key });
  if (error) return false;
  return data === true;
}

// Tous les droits de l'utilisateur connecté, chargés une fois par requête.
export const getMyPermissions = cache(async (): Promise<Set<PermissionKey>> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Set();
  const [{ data: me }, { data: matrix }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    supabase.rpc('permission_matrix'),
  ]);
  const role = me?.role as string | undefined;
  if (!role) return new Set();
  const rows = (matrix ?? []) as { role: string; permission: string; allowed: boolean }[];
  return new Set(
    rows.filter((r) => r.role === role && r.allowed).map((r) => r.permission as PermissionKey)
  );
});
