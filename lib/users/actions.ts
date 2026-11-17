'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasPermission } from '@/lib/permissions';
import { DEPARTMENTS, type UserRole } from '@/lib/users/roles';

function checkDepartment(role: UserRole, department?: string | null) {
  if (role !== 'chef_service') return null;
  if (!department || !DEPARTMENTS.some((d) => d.value === department)) {
    throw new Error('Choisissez le département dirigé par ce chef de service.');
  }
  return department;
}

// Verifie que l'utilisateur courant a le droit de gerer les comptes,
// et renvoie son profil (utile pour recuperer organization_id).
async function requireManagerAccess() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifié');

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, organization_id, role')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile) throw new Error('Profil introuvable');
  // Droit « gerer_utilisateurs » de la matrice (migration 0058) : par défaut
  // super admin et administrateur, réglable par le super admin.
  if (!(await hasPermission('gerer_utilisateurs'))) {
    throw new Error("Vous n'avez pas les droits pour gérer les utilisateurs.");
  }
  return profile;
}

// Un compte super admin ne se modifie que par un super admin ; un compte
// supprimé (archivé) ne se modifie plus. La base applique les mêmes règles.
async function requireEditableTarget(me: { organization_id: string; role: string }, userId: string) {
  const supabase = await createClient();
  const { data: target } = await supabase
    .from('profiles')
    .select('id, role, deleted_at')
    .eq('id', userId)
    .eq('organization_id', me.organization_id)
    .maybeSingle();
  if (!target) throw new Error('Utilisateur introuvable dans votre organisation.');
  if (target.deleted_at) throw new Error('Ce compte a été supprimé.');
  if (target.role === 'super_admin' && me.role !== 'super_admin') {
    throw new Error('Seul un super admin peut modifier un compte super admin.');
  }
  return target;
}

export async function listUsers() {
  const profile = await requireManagerAccess();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, role, department, is_active, created_at, deleted_at')
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export interface CreateUserInput {
  fullName: string;
  email: string;
  phone?: string;
  role: UserRole;
  password: string;
  department?: string | null;
}

export async function createUser(input: CreateUserInput) {
  const profile = await requireManagerAccess();

  // Seul un super_admin peut créer un autre super_admin ou un administrateur
  if (['super_admin', 'administrateur'].includes(input.role) && profile.role !== 'super_admin') {
    throw new Error('Seul un Super Admin peut créer un compte Administrateur ou Super Admin.');
  }
  const department = checkDepartment(input.role, input.department);

  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (createError) throw new Error(createError.message);
  if (!created.user) throw new Error("Échec de la création du compte");

  const { error: profileError } = await admin.from('profiles').insert({
    id: created.user.id,
    organization_id: profile.organization_id,
    role: input.role,
    full_name: input.fullName,
    phone: input.phone,
    email: input.email,
    department,
    is_active: true,
  });
  if (profileError) {
    // évite un compte Auth orphelin sans profil si l'insertion échoue
    await admin.auth.admin.deleteUser(created.user.id);
    throw new Error(profileError.message);
  }

  return { id: created.user.id };
}

export async function updateUserRole(userId: string, role: UserRole, department?: string | null) {
  const profile = await requireManagerAccess();
  if (['super_admin', 'administrateur'].includes(role) && profile.role !== 'super_admin') {
    throw new Error('Seul un Super Admin peut attribuer ce rôle.');
  }
  if (userId === profile.id) throw new Error('Vous ne pouvez pas modifier votre propre rôle.');

  const supabase = await createClient();
  await requireEditableTarget(profile, userId);
  const { error } = await supabase
    .from('profiles')
    .update({ role, department: checkDepartment(role, department) })
    .eq('id', userId)
    .eq('organization_id', profile.organization_id);
  if (error) throw new Error(error.message);
}

export interface UpdateUserProfileInput {
  fullName: string;
  email: string;
  phone?: string;
}

// Correction des informations d'un utilisateur (nom, email, téléphone) par
// un super_admin/administrateur, en cas d'erreur de saisie à la création du
// compte. L'email doit être synchronisé à la fois dans `profiles` (utilisé
// partout dans l'app) et dans Supabase Auth (sinon l'utilisateur ne pourrait
// plus se connecter avec son nouvel email).
export async function updateUserProfile(userId: string, input: UpdateUserProfileInput) {
  const profile = await requireManagerAccess();

  if (!input.fullName.trim()) throw new Error('Le nom complet est obligatoire.');
  if (!input.email.trim()) throw new Error("L'email est obligatoire.");

  // Vérifier la cible AVANT de toucher au compte Auth : sans ce contrôle,
  // un administrateur pouvait remplacer l'email du super admin par le sien,
  // demander un nouveau mot de passe et prendre le contrôle du compte.
  const supabase = await createClient();
  const { data: target } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', userId)
    .eq('organization_id', profile.organization_id)
    .maybeSingle();
  if (!target) throw new Error('Utilisateur introuvable dans votre organisation.');
  if (target.role === 'super_admin' && profile.role !== 'super_admin') {
    throw new Error('Seul un super admin peut modifier un compte super admin.');
  }

  const admin = createAdminClient();

  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    email: input.email,
    email_confirm: true,
  });
  if (authError) throw new Error(authError.message);

  const { error } = await supabase
    .from('profiles')
    .update({ full_name: input.fullName, email: input.email, phone: input.phone })
    .eq('id', userId)
    .eq('organization_id', profile.organization_id);
  if (error) throw new Error(error.message);
}

export async function toggleUserActive(userId: string, isActive: boolean) {
  const profile = await requireManagerAccess();
  if (userId === profile.id) throw new Error('Vous ne pouvez pas désactiver votre propre compte.');

  const supabase = await createClient();
  await requireEditableTarget(profile, userId);
  const { error } = await supabase
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId)
    .eq('organization_id', profile.organization_id);
  if (error) throw new Error(error.message);
}

// ---------- Suppression de comptes (migration 0058) ----------
// 1. prepare_user_deletion : contrôles, transfert des clients et dossiers en
//    cours à un collègue, archivage du profil (désactivé, coordonnées
//    effacées, nom conservé pour l'historique), journal d'audit ;
// 2. suppression du compte de connexion (API Auth, clé service) ;
// 3. purge_deleted_profile : efface le profil s'il n'a laissé aucune trace,
//    sinon le garde archivé (signatures, validations, paiements lisibles).
// Chaque étape peut être relancée sans risque après un échec.

export interface DeletionPreview {
  owned: Record<string, number>;
  owned_total: number;
  history: number;
  last_super_admin: boolean;
}

export async function getUserDeletionPreview(userId: string): Promise<{ error?: string; preview?: DeletionPreview }> {
  try {
    await requireManagerAccess();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('user_deletion_preview', { p_user: userId });
    if (error) return { error: error.message };
    return { preview: data as DeletionPreview };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' };
  }
}

export async function deleteUserAccount(
  userId: string,
  transferTo: string | null,
  confirmName: string
): Promise<{ error?: string; result?: 'supprime' | 'archive' }> {
  try {
    const me = await requireManagerAccess();
    if (userId === me.id) return { error: 'Vous ne pouvez pas supprimer votre propre compte.' };

    const supabase = await createClient();
    const { data: target } = await supabase
      .from('profiles')
      .select('id, full_name, role, deleted_at')
      .eq('id', userId)
      .eq('organization_id', me.organization_id)
      .maybeSingle();
    if (!target) return { error: 'Utilisateur introuvable dans votre organisation.' };
    if (target.role === 'super_admin' && me.role !== 'super_admin') {
      return { error: 'Seul un super admin peut supprimer un compte super admin.' };
    }
    // Confirmation explicite : le nom complet doit être retapé (sauf pour
    // terminer une suppression déjà commencée).
    const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');
    if (!target.deleted_at && norm(confirmName) !== norm(target.full_name ?? '')) {
      return { error: 'Retapez exactement le nom complet de la personne pour confirmer.' };
    }

    const { error: prepError } = await supabase.rpc('prepare_user_deletion', {
      p_user: userId,
      p_transfer_to: transferTo || null,
    });
    if (prepError) return { error: prepError.message };

    const admin = createAdminClient();
    const { error: authError } = await admin.auth.admin.deleteUser(userId);
    if (authError && !/not found/i.test(authError.message)) {
      revalidatePath('/users');
      return {
        error:
          "Le compte est désactivé et ses dossiers transférés, mais la suppression de l'accès a échoué (" +
          authError.message +
          '). Relancez la suppression depuis la liste.',
      };
    }

    const { data: purge, error: purgeError } = await supabase.rpc('purge_deleted_profile', { p_user: userId });
    revalidatePath('/users');
    if (purgeError) return { result: 'archive' };
    return { result: purge === 'supprime' ? 'supprime' : 'archive' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' };
  }
}
