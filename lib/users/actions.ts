'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { UserRole } from '@/lib/users/roles';

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
  if (!['super_admin', 'administrateur'].includes(profile.role)) {
    throw new Error("Vous n'avez pas les droits pour gérer les utilisateurs.");
  }
  return profile;
}

export async function listUsers() {
  const profile = await requireManagerAccess();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, role, is_active, created_at')
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
}

export async function createUser(input: CreateUserInput) {
  const profile = await requireManagerAccess();

  // Seul un super_admin peut créer un autre super_admin ou un administrateur
  if (['super_admin', 'administrateur'].includes(input.role) && profile.role !== 'super_admin') {
    throw new Error('Seul un Super Admin peut créer un compte Administrateur ou Super Admin.');
  }

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
    is_active: true,
  });
  if (profileError) {
    // évite un compte Auth orphelin sans profil si l'insertion échoue
    await admin.auth.admin.deleteUser(created.user.id);
    throw new Error(profileError.message);
  }

  return { id: created.user.id };
}

export async function updateUserRole(userId: string, role: UserRole) {
  const profile = await requireManagerAccess();
  if (['super_admin', 'administrateur'].includes(role) && profile.role !== 'super_admin') {
    throw new Error('Seul un Super Admin peut attribuer ce rôle.');
  }
  if (userId === profile.id) throw new Error('Vous ne pouvez pas modifier votre propre rôle.');

  const supabase = await createClient();
  const { error } = await supabase
    .from('profiles')
    .update({ role })
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
  const { error } = await supabase
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId)
    .eq('organization_id', profile.organization_id);
  if (error) throw new Error(error.message);
}
