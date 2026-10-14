'use server';

// Demandes d'inscription (direction, 09/10/2026) : un chef de service demande
// un compte pour un agent de son département ; seuls le DG, le manager et le
// Super Admin (rôles super_admin, administrateur, manager) valident. La base
// contrôle aussi ces règles (table user_requests, migration 0032).
//
// Les fonctions renvoient { error } au lieu de lever une erreur : en
// production, Next.js masque le message des erreurs levées dans une Server
// Action, ce qui rendrait les refus incompréhensibles.

import { randomInt } from 'crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { DEPARTMENTS, DIRECTION_ROLES, managedDepartment, type UserRole } from '@/lib/users/roles';

async function getMe() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, organization_id, role, department, full_name')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (!profile) return null;
  return { supabase, profile };
}

function temporaryPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () => chars[randomInt(chars.length)]).join('');
}

function friendly(message: string) {
  if (/row-level security/i.test(message)) {
    return "Vous ne pouvez demander un compte que pour un poste de votre département.";
  }
  if (/already been registered|already exists|duplicate/i.test(message)) {
    return 'Un compte existe déjà avec cet e-mail.';
  }
  return message;
}

export interface UserRequestInput {
  fullName: string;
  email: string;
  phone?: string;
  role: UserRole;
  department: string;
  note?: string;
}

export async function createUserRequest(input: UserRequestInput): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me) return { error: 'Session expirée, reconnectez-vous.' };

  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  if (!fullName) return { error: 'Le nom complet est obligatoire.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "L'adresse e-mail n'est pas valide." };

  const isDirection = DIRECTION_ROLES.includes(me.profile.role);
  const myDepartment = managedDepartment(me.profile.role, me.profile.department);
  if (!isDirection && (!myDepartment || myDepartment !== input.department)) {
    return { error: 'Vous ne pouvez demander un compte que pour votre département.' };
  }
  const dept = DEPARTMENTS.find((d) => d.value === input.department);
  if (!dept || !dept.roles.includes(input.role)) {
    return { error: "Ce poste n'existe pas dans ce département." };
  }

  const { error } = await me.supabase.from('user_requests').insert({
    organization_id: me.profile.organization_id,
    requested_by: me.profile.id,
    full_name: fullName,
    email,
    phone: input.phone?.trim() || null,
    role: input.role,
    department: input.department,
    note: input.note?.trim() || null,
  });
  if (error) return { error: friendly(error.message) };

  revalidatePath('/users/demandes');
  return {};
}

export type UserRequestRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  department: string;
  note: string | null;
  status: 'en_attente' | 'validee' | 'refusee';
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
  requester: { full_name: string | null } | null;
};

export async function listUserRequests(): Promise<UserRequestRow[]> {
  const me = await getMe();
  if (!me) return [];
  const { data } = await me.supabase
    .from('user_requests')
    .select(
      'id, full_name, email, phone, role, department, note, status, decision_note, created_at, decided_at, requester:profiles!user_requests_requested_by_fkey(full_name)'
    )
    .order('created_at', { ascending: false })
    .limit(200);
  return ((data ?? []) as unknown as (UserRequestRow & { requester: unknown })[]).map((r) => ({
    ...r,
    requester: Array.isArray(r.requester) ? (r.requester[0] ?? null) : (r.requester as UserRequestRow['requester']),
  }));
}

export async function approveUserRequest(
  requestId: string
): Promise<{ error?: string; email?: string; password?: string; fullName?: string }> {
  const me = await getMe();
  if (!me) return { error: 'Session expirée, reconnectez-vous.' };
  if (!DIRECTION_ROLES.includes(me.profile.role)) {
    return { error: 'Seuls le DG, le manager et le Super Admin valident les inscriptions.' };
  }

  const { data: request } = await me.supabase
    .from('user_requests')
    .select('id, organization_id, requested_by, full_name, email, phone, role, department, status')
    .eq('id', requestId)
    .maybeSingle();
  if (!request) return { error: 'Demande introuvable.' };
  if (request.status !== 'en_attente') return { error: 'Cette demande a déjà été traitée.' };
  const dept = DEPARTMENTS.find((d) => d.value === request.department);
  if (!dept || !dept.roles.includes(request.role as UserRole)) {
    return { error: "Le poste demandé ne correspond pas au département." };
  }

  const password = temporaryPassword();
  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: request.email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) return { error: friendly(createError?.message ?? 'Échec de la création du compte.') };

  const { error: profileError } = await admin.from('profiles').insert({
    id: created.user.id,
    organization_id: me.profile.organization_id,
    role: request.role,
    department: request.department,
    full_name: request.full_name,
    phone: request.phone,
    email: request.email,
    is_active: true,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: friendly(profileError.message) };
  }

  const { error: updateError } = await me.supabase
    .from('user_requests')
    .update({
      status: 'validee',
      decided_by: me.profile.id,
      decided_at: new Date().toISOString(),
      created_user_id: created.user.id,
    })
    .eq('id', requestId);
  if (updateError) return { error: friendly(updateError.message) };

  // Le chef de service qui a fait la demande est prévenu.
  await admin.from('notifications').insert({
    organization_id: me.profile.organization_id,
    user_id: request.requested_by,
    type: 'demande_inscription',
    title: 'Inscription validée',
    message: `Le compte de ${request.full_name} a été créé.`,
  });

  revalidatePath('/users/demandes');
  revalidatePath('/users');
  return { email: request.email, password, fullName: request.full_name };
}

export async function rejectUserRequest(requestId: string, note?: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!me) return { error: 'Session expirée, reconnectez-vous.' };
  if (!DIRECTION_ROLES.includes(me.profile.role)) {
    return { error: 'Seuls le DG, le manager et le Super Admin traitent les inscriptions.' };
  }
  const { data, error } = await me.supabase
    .from('user_requests')
    .update({
      status: 'refusee',
      decided_by: me.profile.id,
      decided_at: new Date().toISOString(),
      decision_note: note?.trim() || null,
    })
    .eq('id', requestId)
    .eq('status', 'en_attente')
    .select('id, requested_by, full_name')
    .maybeSingle();
  if (error) return { error: friendly(error.message) };
  if (!data) return { error: 'Cette demande a déjà été traitée.' };

  const admin = createAdminClient();
  await admin.from('notifications').insert({
    organization_id: me.profile.organization_id,
    user_id: data.requested_by,
    type: 'demande_inscription',
    title: 'Inscription refusée',
    message: `La demande pour ${data.full_name} a été refusée${note?.trim() ? ` : ${note.trim()}` : '.'}`,
  });

  revalidatePath('/users/demandes');
  return {};
}
