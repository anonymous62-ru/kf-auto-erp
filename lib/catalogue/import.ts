// Import des photos officielles depuis nos sites (cheryauto.tg, kfauto.tg).
// Exécuté uniquement côté serveur (Server Actions) :
//   1. lecture d'une page de nos sites et repérage des images ;
//   2. téléchargement des images choisies, conversion en JPEG redimensionné.
// Garde-fous : seules les pages de nos deux sites sont lues ; les images
// doivent être en https sur un nom de domaine public (jamais une adresse IP
// ou un serveur interne), de type image et de taille raisonnable.

export const OFFICIAL_SITES = ['cheryauto.tg', 'kfauto.tg'];

const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_STORED_WIDTH = 1800;

export function isOfficialSite(url: URL) {
  const host = url.hostname.toLowerCase();
  return OFFICIAL_SITES.some((site) => host === site || host.endsWith(`.${site}`));
}

function isSafePublicHttps(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.port && url.port !== '443') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.internal') || host === 'localhost') return null;
  // Adresse IP littérale (v4 ou v6) : refusée.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || host.includes(':')) return null;
  return url;
}

async function fetchLimited(url: URL, maxBytes: number, accept: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { Accept: accept, 'User-Agent': 'KF-Auto-ERP/1.0 (import photos catalogue)' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Le site a répondu ${response.status}.`);
    // Après redirection, l'adresse finale doit rester sûre.
    if (response.url && !isSafePublicHttps(response.url)) throw new Error('Redirection refusée.');
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new Error('Fichier trop volumineux.');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Réponse vide.');
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        throw new Error('Fichier trop volumineux.');
      }
      chunks.push(value);
    }
    return { buffer: Buffer.concat(chunks), contentType: response.headers.get('content-type') ?? '', finalUrl: response.url || url.toString() };
  } finally {
    clearTimeout(timer);
  }
}

export type FoundImage = { url: string; hint: string };

// Repère les images d'une page (balises img, srcset, lazy-loading, og:image,
// images de fond), en gardant la plus grande variante de chaque srcset.
export async function scanOfficialPage(rawUrl: string): Promise<FoundImage[]> {
  const url = isSafePublicHttps(rawUrl.trim());
  if (!url || !isOfficialSite(url)) {
    throw new Error(`Collez l'adresse d'une page de ${OFFICIAL_SITES.join(' ou ')} (https).`);
  }
  const { buffer, contentType, finalUrl } = await fetchLimited(url, MAX_PAGE_BYTES, 'text/html');
  if (!contentType.includes('html')) throw new Error("Cette adresse n'est pas une page web.");
  const base = new URL(finalUrl);
  if (!isOfficialSite(base)) throw new Error('La page a redirigé vers un autre site.');
  const html = buffer.toString('utf8');

  const found = new Map<string, string>();
  const add = (candidate: string | undefined, hint: string) => {
    if (!candidate) return;
    const cleaned = candidate.trim().replace(/&amp;/g, '&');
    if (!cleaned || cleaned.startsWith('data:')) return;
    try {
      const abs = new URL(cleaned, base);
      if (abs.protocol !== 'https:' && abs.protocol !== 'http:') return;
      abs.protocol = 'https:';
      const path = abs.pathname.toLowerCase();
      if (/\.(svg|gif|ico)$/.test(path)) return;
      if (/(favicon|sprite|placeholder|loader|spinner)/.test(path)) return;
      if (!found.has(abs.toString())) found.set(abs.toString(), hint);
    } catch {
      // adresse illisible : ignorée
    }
  };
  const largestFromSrcset = (srcset: string) => {
    let best: { url: string; w: number } | null = null;
    for (const part of srcset.split(',')) {
      const [u, size] = part.trim().split(/\s+/);
      const w = Number((size ?? '').replace(/[^\d.]/g, '')) || 0;
      if (u && (!best || w > best.w)) best = { url: u, w };
    }
    return best?.url;
  };

  for (const m of html.matchAll(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/gi)) add(m[1], 'Image principale de la page');
  for (const tag of html.matchAll(/<(img|source)\b[^>]*>/gi)) {
    const t = tag[0];
    const alt = /alt=["']([^"']*)["']/i.exec(t)?.[1] ?? '';
    const srcset = /(?:data-srcset|srcset)=["']([^"']+)["']/i.exec(t)?.[1];
    if (srcset) add(largestFromSrcset(srcset), alt);
    add(/(?:data-src|data-lazy-src|data-original|src)=["']([^"']+)["']/i.exec(t)?.[1], alt);
  }
  for (const m of html.matchAll(/url\(\s*['"]?([^'")]+\.(?:jpe?g|png|webp)[^'")]*)['"]?\s*\)/gi)) add(m[1], 'Image de fond');

  return Array.from(found.entries())
    .slice(0, 80)
    .map(([u, hint]) => ({ url: u, hint }));
}

// Télécharge une image et la prépare pour le stockage : JPEG, 1 800 px de
// large au plus (sharp, installé avec Next.js). Sans sharp, seuls JPEG et PNG
// sont acceptés tels quels.
export async function downloadImageForCatalogue(rawUrl: string): Promise<{ buffer: Buffer; contentType: 'image/jpeg' | 'image/png' }> {
  const url = isSafePublicHttps(rawUrl);
  if (!url) throw new Error("Adresse d'image refusée.");
  const { buffer, contentType } = await fetchLimited(url, MAX_IMAGE_BYTES, 'image/*');
  if (!/^image\/(jpeg|jpg|png|webp|avif)/i.test(contentType)) throw new Error("Ce fichier n'est pas une photo.");

  try {
    const sharp = (await import('sharp')).default;
    const out = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width: MAX_STORED_WIDTH, withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    return { buffer: out, contentType: 'image/jpeg' };
  } catch (e) {
    if (/jpe?g/i.test(contentType) && buffer.length <= 6 * 1024 * 1024) return { buffer, contentType: 'image/jpeg' };
    if (/png/i.test(contentType) && buffer.length <= 6 * 1024 * 1024) return { buffer, contentType: 'image/png' };
    console.error('[catalogue] conversion impossible :', e instanceof Error ? e.message : e);
    throw new Error('Format de photo non pris en charge (utilisez JPG ou PNG).');
  }
}
