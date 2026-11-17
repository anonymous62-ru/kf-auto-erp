'use server';

// Pièces justificatives des clients (migration 0046).
// Le fichier part directement du navigateur vers le bucket privé
// client-documents (policies storage.objects), puis cette action vérifie
// l'objet déposé et enregistre la ligne client_documents (RLS).
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  CLIENT_DOCUMENT_MAX_BYTES,
  clientDocumentMime,
  isClientDocumentKind,
  validateClientDocumentFile,
} from '@/lib/clients/required-documents';

const BUCKET = 'client-documents';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RegisterClientDocumentInput {
  clientId: string;
  kind: string;
  storagePath: string;
  fileName: string;
}

export async function registerClientDocument(input: RegisterClientDocumentInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Non authentifié' };
  if (!UUID_RE.test(input.clientId) || !isClientDocumentKind(input.kind)) return { ok: false, error: 'Demande invalide.' };

  const { data: client } = await supabase.from('clients').select('id, organization_id').eq('id', input.clientId).maybeSingle();
  if (!client) return { ok: false, error: 'Client introuvable.' };

  const prefix = `${client.organization_id}/${client.id}/`;
  const rest = input.storagePath.slice(prefix.length);
  if (!input.storagePath.startsWith(prefix) || !rest || rest.includes('/')) {
    return { ok: false, error: 'Chemin de fichier invalide.' };
  }

  // Contrôle serveur sur l'objet réellement déposé (taille et type).
  const { data: listed, error: listError } = await supabase.storage.from(BUCKET).list(`${client.organization_id}/${client.id}`, {
    search: rest,
    limit: 5,
  });
  const object = listed?.find((o) => o.name === rest);
  if (listError || !object) return { ok: false, error: "Fichier introuvable après l'envoi. Réessayez." };
  const meta = (object.metadata ?? {}) as { size?: number; mimetype?: string };
  const size = Number(meta.size ?? 0);
  const mime = clientDocumentMime(input.fileName, String(meta.mimetype ?? ''));
  const invalid = validateClientDocumentFile(input.fileName, mime ?? '', size);
  if (invalid || !mime || size > CLIENT_DOCUMENT_MAX_BYTES) {
    await supabase.storage.from(BUCKET).remove([input.storagePath]);
    return { ok: false, error: invalid ?? 'Fichier refusé.' };
  }

  const { error } = await supabase.from('client_documents').insert({
    organization_id: client.organization_id,
    client_id: client.id,
    kind: input.kind,
    storage_path: input.storagePath,
    file_name: input.fileName.slice(0, 200) || 'piece',
    mime_type: mime,
    size_bytes: size,
    uploaded_by: user.id,
  });
  if (error) {
    await supabase.storage.from(BUCKET).remove([input.storagePath]);
    return { ok: false, error: error.code === '42501' ? "Vous n'avez pas le droit d'ajouter une pièce à ce client." : error.message };
  }

  revalidatePath(`/clients/${client.id}`);
  revalidatePath('/clients');
  return { ok: true };
}

// Nettoie un fichier déposé dont l'enregistrement n'a pas abouti.
export async function discardClientUpload(storagePath: string) {
  const supabase = await createClient();
  const { count } = await supabase.from('client_documents').select('id', { count: 'exact', head: true }).eq('storage_path', storagePath);
  if (count) return;
  await supabase.storage.from(BUCKET).remove([storagePath]);
}

export async function deleteClientDocument(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Non authentifié' };
  if (!UUID_RE.test(id)) return { ok: false, error: 'Demande invalide.' };

  const { data: doc } = await supabase.from('client_documents').select('id, client_id, storage_path').eq('id', id).maybeSingle();
  if (!doc) return { ok: false, error: 'Pièce introuvable.' };

  // Fichier d'abord (la policy storage vérifie la ligne), puis la ligne.
  const { data: removed, error: removeError } = await supabase.storage.from(BUCKET).remove([doc.storage_path]);
  if (removeError) return { ok: false, error: removeError.message };
  if (!removed || removed.length === 0) {
    return { ok: false, error: "Suppression refusée : seuls la direction, l'ADV ou l'auteur (dans les 24 h) peuvent retirer cette pièce." };
  }
  const { error } = await supabase.from('client_documents').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/clients/${doc.client_id}`);
  revalidatePath('/clients');
  return { ok: true };
}

// URL signée courte (60 s) pour consulter ou télécharger une pièce.
export async function getClientDocumentUrl(id: string, download = false): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  if (!UUID_RE.test(id)) return { ok: false, error: 'Demande invalide.' };
  const { data: doc } = await supabase.from('client_documents').select('storage_path, file_name').eq('id', id).maybeSingle();
  if (!doc) return { ok: false, error: 'Pièce introuvable.' };
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path, 60, download ? { download: doc.file_name } : undefined);
  if (error || !data) return { ok: false, error: error?.message ?? 'Lien indisponible.' };
  return { ok: true, url: data.signedUrl };
}
