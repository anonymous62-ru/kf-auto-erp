'use server';

// Matrice des droits (migrations 0054 et 0058) : seul le super admin coche ou
// décoche un droit pour un rôle. La base vérifie elle-même le rôle de
// l'appelant (set_role_permission, reset_role_permissions) et journalise.
// Les fonctions renvoient { error } : en production, Next.js masque le
// message des erreurs levées dans une Server Action.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { PERMISSIONS } from '@/lib/users/permission-catalog';
import { ALL_ROLES } from '@/lib/users/roles';

function checkInputs(role: string, permission?: string) {
  if (!ALL_ROLES.includes(role as (typeof ALL_ROLES)[number])) return 'Rôle inconnu.';
  if (role === 'super_admin') return 'Le super administrateur garde toujours tous les droits.';
  if (permission !== undefined && !PERMISSIONS.some((p) => p.key === permission)) return 'Droit inconnu.';
  return null;
}

export async function setRolePermission(role: string, permission: string, allowed: boolean): Promise<{ error?: string }> {
  const invalid = checkInputs(role, permission);
  if (invalid) return { error: invalid };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_role_permission', {
    p_role: role,
    p_permission: permission,
    p_allowed: allowed,
  });
  if (error) return { error: error.message };
  revalidatePath('/users/droits');
  return {};
}

export async function resetRolePermissions(role: string): Promise<{ error?: string }> {
  const invalid = checkInputs(role);
  if (invalid) return { error: invalid };
  const supabase = await createClient();
  const { error } = await supabase.rpc('reset_role_permissions', { p_role: role });
  if (error) return { error: error.message };
  revalidatePath('/users/droits');
  return {};
}
