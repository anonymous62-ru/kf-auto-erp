// Les signatures (dossier "document-signatures") ne sont plus publiques :
// pour les afficher à un employé connecté, on génère côté serveur un lien
// temporaire (10 minutes). Le chemin est relu dans l'URL enregistrée au
// moment de la signature.
import { createAdminClient } from '@/lib/supabase/admin';

const MARKERS = ['/storage/v1/object/public/', '/storage/v1/object/sign/'];

export async function signedStorageUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  const marker = MARKERS.find((m) => url.includes(m));
  if (!marker) return url;
  let rest = url.slice(url.indexOf(marker) + marker.length).split('?')[0];
  const slash = rest.indexOf('/');
  if (slash === -1) return url;
  const bucket = rest.slice(0, slash);
  rest = decodeURIComponent(rest.slice(slash + 1));
  if (bucket !== 'document-signatures') return url;
  const { data } = await createAdminClient().storage.from(bucket).createSignedUrl(rest, 600);
  return data?.signedUrl ?? null;
}
