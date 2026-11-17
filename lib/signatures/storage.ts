// Signatures enregistrées et cachets (migration 0055), bucket privé
// « user-signatures ». Lecture côté serveur uniquement, avec la clé
// service_role, après que l'accès au document ou à la page a été contrôlé.
// Chemins acceptés : <org>/users/<user_id>/<fichier>.png|jpg ou
// <org>/stamps/<fichier>.png|jpg (même règle que la base).
import { createAdminClient } from '@/lib/supabase/admin';

export const SIGNATURE_BUCKET = 'user-signatures';

const FILE = /^[A-Za-z0-9_-]{1,80}\.(png|jpg)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSignaturePath(path: string | null | undefined): path is string {
  if (!path) return false;
  const parts = path.split('/');
  if (!UUID.test(parts[0] ?? '')) return false;
  if (parts.length === 4) return parts[1] === 'users' && UUID.test(parts[2]) && FILE.test(parts[3]);
  if (parts.length === 3) return parts[1] === 'stamps' && FILE.test(parts[2]);
  return false;
}

// Image en data URI (PDF). Ne lève jamais : une image manquante est sautée.
export async function signatureDataUri(path: string | null | undefined): Promise<string | null> {
  if (!isSignaturePath(path)) return null;
  try {
    const { data, error } = await createAdminClient().storage.from(SIGNATURE_BUCKET).download(path);
    if (error || !data) throw error ?? new Error('Téléchargement vide');
    const buffer = Buffer.from(await data.arrayBuffer());
    const mime = path.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch (e) {
    console.error(`[signatures] image illisible ${path} :`, e instanceof Error ? e.message : e);
    return null;
  }
}

// Lien temporaire (10 minutes) pour afficher l'image à un employé connecté.
export async function signatureSignedUrl(path: string | null | undefined): Promise<string | null> {
  if (!isSignaturePath(path)) return null;
  const { data } = await createAdminClient().storage.from(SIGNATURE_BUCKET).createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}
