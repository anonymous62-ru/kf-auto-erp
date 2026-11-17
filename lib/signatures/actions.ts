'use server';

// Signature enregistrée de chaque utilisateur et cachets de l'entreprise
// (migration 0055). Les fichiers sont déposés avec la session de
// l'utilisateur : les policies du bucket privé « user-signatures » décident
// (chacun sa signature ; la direction celles des autres et les cachets).
// La base vérifie ensuite le chemin enregistré (triggers de 0055).
// Chaque changement crée un nouveau fichier : les proformas déjà signées
// gardent l'image figée au moment de la soumission ou de la validation.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type SignatureActionResult = { error: string } | undefined;
export type StampKind = 'commercial' | 'sales_manager' | 'direction';

const MAX_BYTES = 800 * 1024;
const ADMIN_ROLES = ['super_admin', 'administrateur'];
const STAMP_COLUMNS: Record<StampKind, string> = {
  commercial: 'stamp_commercial_path',
  sales_manager: 'stamp_sales_manager_path',
  direction: 'stamp_direction_path',
};

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.organization_id) return null;
  return { supabase, userId: user.id, role: profile.role as string, orgId: profile.organization_id as string };
}

// Contrôle du fichier reçu : taille et signature binaire PNG / JPEG (le type
// annoncé par le navigateur ne suffit pas).
async function readImage(value: FormDataEntryValue | null): Promise<{ bytes: Uint8Array; ext: 'png' | 'jpg' } | { error: string }> {
  if (!value || typeof value === 'string') return { error: 'Aucune image reçue.' };
  if (value.size === 0) return { error: 'Image vide.' };
  if (value.size > MAX_BYTES) return { error: "L'image dépasse 800 Ko : réduisez-la ou recadrez-la." };
  const bytes = new Uint8Array(await value.arrayBuffer());
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPng && !isJpg) return { error: 'Format non supporté : utilisez une image PNG ou JPG.' };
  return { bytes, ext: isPng ? 'png' : 'jpg' };
}

function fileName(prefix: string, ext: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

function readable(message: string | undefined, fallback: string) {
  const text = (message ?? '').trim();
  if (/row-level security|violates|Unauthorized|403/i.test(text)) return "Vous n'avez pas le droit d'enregistrer cette image.";
  if (/column .* does not exist|schema cache/i.test(text)) return "Les signatures ne sont pas encore installées dans la base (migration 0055).";
  return text || fallback;
}

function refresh() {
  revalidatePath('/settings/signature');
  revalidatePath('/settings/organisation');
}

// Enregistre la signature de l'utilisateur connecté, ou d'un autre
// utilisateur de l'organisation (direction uniquement) si « userId » est fourni.
export async function saveSignature(formData: FormData): Promise<SignatureActionResult> {
  const me = await currentUser();
  if (!me) return { error: 'Session expirée, reconnectez-vous.' };
  const requested = String(formData.get('userId') ?? '').trim();
  const target = requested || me.userId;
  if (target !== me.userId && !ADMIN_ROLES.includes(me.role)) {
    return { error: "Seule la direction peut enregistrer la signature d'un autre utilisateur." };
  }
  const image = await readImage(formData.get('file'));
  if ('error' in image) return image;

  const path = `${me.orgId}/users/${target}/${fileName('signature', image.ext)}`;
  const { error: uploadError } = await me.supabase.storage
    .from('user-signatures')
    .upload(path, image.bytes, { contentType: image.ext === 'png' ? 'image/png' : 'image/jpeg', upsert: false });
  if (uploadError) return { error: readable(uploadError.message, "L'envoi de la signature a échoué.") };

  const { data, error } = await me.supabase.from('profiles').update({ signature_path: path }).eq('id', target).select('id');
  if (error) return { error: readable(error.message, "L'enregistrement de la signature a échoué.") };
  if (!data || data.length === 0) return { error: 'Utilisateur introuvable.' };
  refresh();
  return undefined;
}

// Retire la signature enregistrée (le fichier reste lisible par les
// proformas qui l'ont déjà figée).
export async function removeSignature(userId?: string): Promise<SignatureActionResult> {
  const me = await currentUser();
  if (!me) return { error: 'Session expirée, reconnectez-vous.' };
  const target = userId || me.userId;
  if (target !== me.userId && !ADMIN_ROLES.includes(me.role)) {
    return { error: "Seule la direction peut retirer la signature d'un autre utilisateur." };
  }
  const { data, error } = await me.supabase.from('profiles').update({ signature_path: null }).eq('id', target).select('id');
  if (error) return { error: readable(error.message, 'Le retrait a échoué.') };
  if (!data || data.length === 0) return { error: 'Utilisateur introuvable.' };
  refresh();
  return undefined;
}

export async function saveOrganizationStamp(formData: FormData): Promise<SignatureActionResult> {
  const me = await currentUser();
  if (!me) return { error: 'Session expirée, reconnectez-vous.' };
  if (!ADMIN_ROLES.includes(me.role)) return { error: 'Seule la direction peut modifier les cachets.' };
  const kind = String(formData.get('kind') ?? '') as StampKind;
  const column = STAMP_COLUMNS[kind];
  if (!column) return { error: 'Cachet inconnu.' };
  const image = await readImage(formData.get('file'));
  if ('error' in image) return image;

  const path = `${me.orgId}/stamps/${fileName(`cachet-${kind.replace('_', '-')}`, image.ext)}`;
  const { error: uploadError } = await me.supabase.storage
    .from('user-signatures')
    .upload(path, image.bytes, { contentType: image.ext === 'png' ? 'image/png' : 'image/jpeg', upsert: false });
  if (uploadError) return { error: readable(uploadError.message, "L'envoi du cachet a échoué.") };

  const { data, error } = await me.supabase
    .from('organizations')
    .update({ [column]: path })
    .eq('id', me.orgId)
    .select('id');
  if (error) return { error: readable(error.message, "L'enregistrement du cachet a échoué.") };
  if (!data || data.length === 0) return { error: 'Organisation introuvable.' };
  refresh();
  return undefined;
}

export async function removeOrganizationStamp(kind: StampKind): Promise<SignatureActionResult> {
  const me = await currentUser();
  if (!me) return { error: 'Session expirée, reconnectez-vous.' };
  if (!ADMIN_ROLES.includes(me.role)) return { error: 'Seule la direction peut modifier les cachets.' };
  const column = STAMP_COLUMNS[kind];
  if (!column) return { error: 'Cachet inconnu.' };
  const { data, error } = await me.supabase
    .from('organizations')
    .update({ [column]: null })
    .eq('id', me.orgId)
    .select('id');
  if (error) return { error: readable(error.message, 'Le retrait a échoué.') };
  if (!data || data.length === 0) return { error: 'Organisation introuvable.' };
  refresh();
  return undefined;
}
