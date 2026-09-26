// Convertit une URL de logo/signature en data URI avant de la passer au
// moteur PDF (@react-pdf/renderer). Cause la plus probable du HTTP 500 sur
// le telechargement du PDF : le moteur PDF fait lui-meme un fetch() de
// l'image via son URL Supabase Storage ; si le bucket n'est pas
// reellement public (ou bloque les requetes non-authentifiees), ce fetch
// echoue et fait planter tout le rendu. En recuperant le fichier ICI, avec
// la cle service_role (qui contourne toutes les policies Storage), on
// elimine ce risque completement, que le bucket soit public ou prive.
import { createAdminClient } from '@/lib/supabase/admin';

function parseSupabaseStorageUrl(url: string): { bucket: string; path: string } | null {
  const marker = '/storage/v1/object/public/';
  const signedMarker = '/storage/v1/object/sign/';
  const idx = url.indexOf(marker);
  const signedIdx = url.indexOf(signedMarker);
  const start = idx !== -1 ? idx + marker.length : signedIdx !== -1 ? signedIdx + signedMarker.length : -1;
  if (start === -1) return null;

  let rest = url.slice(start);
  const queryIdx = rest.indexOf('?');
  if (queryIdx !== -1) rest = rest.slice(0, queryIdx); // enleve le token de signature eventuel

  const slashIdx = rest.indexOf('/');
  if (slashIdx === -1) return null;
  return { bucket: rest.slice(0, slashIdx), path: decodeURIComponent(rest.slice(slashIdx + 1)) };
}

export async function urlToDataUri(url: string | null | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  if (url.startsWith('data:')) return url; // deja une data URI

  try {
    const parsed = parseSupabaseStorageUrl(url);
    if (parsed) {
      const admin = createAdminClient();
      const { data, error } = await admin.storage.from(parsed.bucket).download(parsed.path);
      if (error || !data) throw error ?? new Error('Téléchargement vide');
      const buffer = Buffer.from(await data.arrayBuffer());
      const mime = data.type || 'image/png';
      return `data:${mime};base64,${buffer.toString('base64')}`;
    }

    // URL externe (pas un fichier Supabase Storage) : recuperation directe
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const mime = response.headers.get('content-type') || 'image/png';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch (e) {
    // on ne fait JAMAIS planter le PDF pour une image manquante : on la saute simplement
    console.error(`[pdf] impossible de récupérer l'image ${url} :`, e instanceof Error ? e.message : e);
    return undefined;
  }
}

// Même logique que urlToDataUri, mais renvoie un Buffer brut + un type
// reconnu par docx-js (ImageRun exige "png"|"jpg"|"gif"|"bmp", pas un mime
// type) — utilisé par l'export DOCX plutôt qu'une data URI.
export async function urlToImageBuffer(
  url: string | null | undefined
): Promise<{ buffer: Buffer; type: 'png' | 'jpg' | 'gif' | 'bmp' } | undefined> {
  if (!url) return undefined;

  function mimeToDocxType(mime: string): 'png' | 'jpg' | 'gif' | 'bmp' {
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('gif')) return 'gif';
    if (mime.includes('bmp')) return 'bmp';
    return 'png';
  }

  try {
    if (url.startsWith('data:')) {
      const [header, base64] = url.split(',');
      const mime = header.slice(5, header.indexOf(';'));
      return { buffer: Buffer.from(base64, 'base64'), type: mimeToDocxType(mime) };
    }

    const parsed = parseSupabaseStorageUrl(url);
    if (parsed) {
      const admin = createAdminClient();
      const { data, error } = await admin.storage.from(parsed.bucket).download(parsed.path);
      if (error || !data) throw error ?? new Error('Téléchargement vide');
      const buffer = Buffer.from(await data.arrayBuffer());
      return { buffer, type: mimeToDocxType(data.type || 'image/png') };
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, type: mimeToDocxType(response.headers.get('content-type') || 'image/png') };
  } catch (e) {
    console.error(`[docx] impossible de récupérer l'image ${url} :`, e instanceof Error ? e.message : e);
    return undefined;
  }
}
