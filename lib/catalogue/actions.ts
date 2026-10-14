'use server';

// Catalogue produits (direction, 10/10/2026) : photos, textes, envois.
// Les actions renvoient { error } au lieu de lever une erreur (Next.js masque
// les messages d'erreur en production). La base applique les mêmes droits
// (migration 0038).

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isStorageUrlInBucket } from '@/lib/documents/pdf/storage-to-data-uri';
import { toWhatsappNumber } from '@/lib/utils/phone';
import { CATALOGUE_EDITOR_ROLES, CATALOGUE_LINK_DAYS, CATALOGUE_SENDER_ROLES } from '@/lib/catalogue/roles';
import { downloadImageForCatalogue, scanOfficialPage, type FoundImage } from '@/lib/catalogue/import';

type Me = { id: string; role: string; organizationId: string; fullName: string; phone: string | null };

async function me(): Promise<Me | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('role, organization_id, full_name, phone').eq('id', user.id).maybeSingle();
  if (!data) return null;
  return {
    id: user.id,
    role: data.role as string,
    organizationId: data.organization_id as string,
    fullName: (data.full_name as string | null) ?? '',
    phone: (data.phone as string | null) ?? null,
  };
}

const NOT_EDITOR = "Seules l'administration et la chargée marketing modifient les photos et les textes du catalogue.";

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------
export type CataloguePhoto = { id: string; url: string; kind: string; is_main: boolean; position: number };

export async function getCataloguePhotos(productId: string): Promise<CataloguePhoto[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('product_photos')
    .select('id, url, kind, is_main, position')
    .eq('product_id', productId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  return (data ?? []) as CataloguePhoto[];
}

async function insertPhoto(
  user: Me,
  input: { productId: string; storagePath: string; url: string; kind: string; sourceUrl?: string | null }
): Promise<{ photo?: CataloguePhoto; error?: string }> {
  const supabase = await createClient();
  const { data: last } = await supabase
    .from('product_photos')
    .select('position')
    .eq('product_id', input.productId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { count } = await supabase
    .from('product_photos')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', input.productId)
    .eq('is_main', true);
  const isMain = (count ?? 0) === 0;

  const { data, error } = await supabase
    .from('product_photos')
    .insert({
      organization_id: user.organizationId,
      product_id: input.productId,
      storage_path: input.storagePath,
      url: input.url,
      bucket: 'vehicules',
      kind: ['exterieur', 'interieur', 'detail'].includes(input.kind) ? input.kind : 'exterieur',
      is_main: isMain,
      source_url: input.sourceUrl ?? null,
      position: ((last?.position as number | undefined) ?? -1) + 1,
      uploaded_by: user.id,
    })
    .select('id, url, kind, is_main, position')
    .single();
  if (error || !data) return { error: error?.message ?? "La photo n'a pas pu être enregistrée." };
  // Première photo : devient la principale (et la vignette du modèle).
  if (isMain) {
    await supabase.rpc('set_product_photo_order', { p_product_id: input.productId, p_photo_ids: [], p_main_id: data.id });
  }
  return { photo: data as CataloguePhoto };
}

// Photo déjà envoyée dans le bucket « vehicules » par le navigateur.
export async function registerUploadedPhoto(input: {
  productId: string;
  storagePath: string;
  url: string;
  kind: string;
}): Promise<{ photo?: CataloguePhoto; error?: string }> {
  const user = await me();
  if (!user) return { error: 'Session expirée, reconnectez-vous.' };
  if (!CATALOGUE_EDITOR_ROLES.includes(user.role)) return { error: NOT_EDITOR };
  if (
    !isStorageUrlInBucket(input.url, 'vehicules') ||
    input.storagePath.includes('..') ||
    !input.storagePath.startsWith(`${user.organizationId}/${input.productId}/`)
  ) {
    return { error: 'Photo invalide.' };
  }
  const result = await insertPhoto(user, input);
  revalidatePath(`/products/${input.productId}`);
  return result;
}

export async function getOrganizationIdForUpload(): Promise<string | null> {
  const user = await me();
  return user && CATALOGUE_EDITOR_ROLES.includes(user.role) ? user.organizationId : null;
}

export async function savePhotoOrder(productId: string, orderedIds: string[], mainId: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_product_photo_order', {
    p_product_id: productId,
    p_photo_ids: orderedIds,
    p_main_id: mainId,
  });
  if (error) return { error: error.message };
  revalidatePath(`/products/${productId}`);
  revalidatePath('/products');
  return {};
}

export async function setPhotoKind(photoId: string, kind: string) {
  if (!['exterieur', 'interieur', 'detail'].includes(kind)) return { error: 'Type de photo invalide.' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('product_photos').update({ kind }).eq('id', photoId).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: NOT_EDITOR };
  return {};
}

export async function removeCataloguePhoto(photoId: string) {
  const user = await me();
  if (!user) return { error: 'Session expirée, reconnectez-vous.' };
  if (!CATALOGUE_EDITOR_ROLES.includes(user.role)) return { error: NOT_EDITOR };
  const supabase = await createClient();
  const { data: photo } = await supabase
    .from('product_photos')
    .select('id, product_id, storage_path, bucket, is_main')
    .eq('id', photoId)
    .maybeSingle();
  if (!photo) return { error: 'Photo introuvable.' };

  const { data: removed, error } = await supabase.from('product_photos').delete().eq('id', photoId).select('id');
  if (error) return { error: error.message };
  if (!removed || removed.length === 0) return { error: NOT_EDITOR };

  // Fichier retiré du stockage après validation des droits par la base.
  const bucket = (photo.bucket as string) === 'vehicules' ? 'vehicules' : 'vehicle-photos';
  try {
    await createAdminClient().storage.from(bucket).remove([photo.storage_path as string]);
  } catch (e) {
    console.error('[catalogue] fichier non retiré :', e instanceof Error ? e.message : e);
  }

  // La photo principale supprimée : la suivante prend sa place.
  if (photo.is_main) {
    const { data: rest } = await supabase
      .from('product_photos')
      .select('id')
      .eq('product_id', photo.product_id)
      .order('position', { ascending: true });
    const ids = (rest ?? []).map((r) => r.id as string);
    await supabase.rpc('set_product_photo_order', { p_product_id: photo.product_id, p_photo_ids: ids, p_main_id: ids[0] ?? null });
  }
  revalidatePath(`/products/${photo.product_id}`);
  return {};
}

// ---------------------------------------------------------------------------
// Import depuis nos sites officiels
// ---------------------------------------------------------------------------
export async function findOfficialImages(pageUrl: string): Promise<{ images?: FoundImage[]; error?: string }> {
  const user = await me();
  if (!user) return { error: 'Session expirée, reconnectez-vous.' };
  if (!CATALOGUE_EDITOR_ROLES.includes(user.role)) return { error: NOT_EDITOR };
  try {
    const images = await scanOfficialPage(pageUrl);
    if (images.length === 0) return { error: 'Aucune photo trouvée sur cette page.' };
    return { images };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Lecture de la page impossible.' };
  }
}

export async function importOfficialImages(input: {
  productId: string;
  imageUrls: string[];
  kind: string;
}): Promise<{ photos?: CataloguePhoto[]; error?: string; failed?: number }> {
  const user = await me();
  if (!user) return { error: 'Session expirée, reconnectez-vous.' };
  if (!CATALOGUE_EDITOR_ROLES.includes(user.role)) return { error: NOT_EDITOR };
  if (input.imageUrls.length === 0) return { error: 'Choisissez au moins une photo.' };
  if (input.imageUrls.length > 12) return { error: '12 photos au plus par import.' };

  const supabase = await createClient();
  const { data: product } = await supabase.from('products').select('id').eq('id', input.productId).maybeSingle();
  if (!product) return { error: 'Modèle introuvable.' };

  const admin = createAdminClient();
  const photos: CataloguePhoto[] = [];
  let failed = 0;
  for (const url of input.imageUrls) {
    try {
      const { buffer, contentType } = await downloadImageForCatalogue(url);
      const ext = contentType === 'image/png' ? 'png' : 'jpg';
      const path = `${user.organizationId}/${input.productId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await admin.storage.from('vehicules').upload(path, buffer, { contentType, cacheControl: '31536000' });
      if (upErr) throw upErr;
      const publicUrl = admin.storage.from('vehicules').getPublicUrl(path).data.publicUrl;
      const result = await insertPhoto(user, { productId: input.productId, storagePath: path, url: publicUrl, kind: input.kind, sourceUrl: url });
      if (result.photo) photos.push(result.photo);
      else {
        failed += 1;
        await admin.storage.from('vehicules').remove([path]);
      }
    } catch (e) {
      failed += 1;
      console.error('[catalogue] import refusé :', url, e instanceof Error ? e.message : e);
    }
  }
  revalidatePath(`/products/${input.productId}`);
  if (photos.length === 0) return { error: "Aucune photo n'a pu être importée.", failed };
  return { photos, failed };
}

// ---------------------------------------------------------------------------
// Textes du catalogue
// ---------------------------------------------------------------------------
export type CatalogueTexts = { tagline: string; highlights: string; equipment: string; colors: string };

export async function getCatalogueTexts(productId: string): Promise<CatalogueTexts> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('product_catalogue')
    .select('tagline, highlights, equipment, colors')
    .eq('product_id', productId)
    .maybeSingle();
  return {
    tagline: (data?.tagline as string | null) ?? '',
    highlights: (data?.highlights as string | null) ?? '',
    equipment: (data?.equipment as string | null) ?? '',
    colors: (data?.colors as string | null) ?? '',
  };
}

export async function saveCatalogueTexts(productId: string, texts: CatalogueTexts) {
  const user = await me();
  if (!user) return { error: 'Session expirée, reconnectez-vous.' };
  if (!CATALOGUE_EDITOR_ROLES.includes(user.role)) return { error: NOT_EDITOR };
  const clean = (v: string, max: number) => v.replace(/\r/g, '').trim().slice(0, max) || null;
  const supabase = await createClient();
  const { error } = await supabase.from('product_catalogue').upsert(
    {
      product_id: productId,
      organization_id: user.organizationId,
      tagline: clean(texts.tagline, 160),
      highlights: clean(texts.highlights, 1500),
      equipment: clean(texts.equipment, 2000),
      colors: clean(texts.colors, 300),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'product_id' }
  );
  if (error) return { error: error.message };
  revalidatePath(`/products/${productId}`);
  return {};
}

// ---------------------------------------------------------------------------
// Envoi d'un catalogue
// ---------------------------------------------------------------------------
export type SendCatalogueInput = {
  productIds: string[];
  kind: 'fiche' | 'gamme';
  showPrices: boolean;
  pricesValidUntil: string | null;
  channel: 'whatsapp' | 'email' | 'lien';
  clientId?: string | null;
  prospectId?: string | null;
  recipientName: string;
  recipientPhone: string;
  recipientEmail: string;
  message: string;
};

export type SendCatalogueResult =
  | { error: string }
  | { url: string; openUrl: string | null; copyText: string };

function absoluteOrigin() {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return 'https://kf-auto-erp.vercel.app';
}

export async function sendCatalogue(input: SendCatalogueInput): Promise<SendCatalogueResult> {
  const user = await me();
  if (!user) return { error: 'Session expirée, reconnectez-vous.' };
  if (!CATALOGUE_SENDER_ROLES.includes(user.role)) return { error: "Votre rôle ne permet pas d'envoyer de catalogue." };

  const ids = Array.from(new Set(input.productIds)).slice(0, 20);
  if (ids.length === 0) return { error: 'Choisissez au moins un modèle.' };
  const kind = ids.length === 1 ? 'fiche' : 'gamme';
  if (input.showPrices) {
    if (!input.pricesValidUntil || !/^\d{4}-\d{2}-\d{2}$/.test(input.pricesValidUntil)) {
      return { error: 'Indiquez la date de validité des prix.' };
    }
    if (input.pricesValidUntil < new Date().toISOString().slice(0, 10)) {
      return { error: 'La date de validité des prix est déjà passée.' };
    }
  }
  const phone = input.recipientPhone.trim();
  const email = input.recipientEmail.trim();
  if (input.channel === 'whatsapp' && !toWhatsappNumber(phone)) return { error: 'Indiquez le numéro WhatsApp du destinataire.' };
  if (input.channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Indiquez l'adresse e-mail du destinataire." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('catalogue_sendings')
    .insert({
      organization_id: user.organizationId,
      created_by: user.id,
      client_id: input.clientId || null,
      prospect_id: input.prospectId || null,
      recipient_name: input.recipientName.trim() || null,
      recipient_phone: phone || null,
      recipient_email: email || null,
      channel: input.channel,
      kind,
      product_ids: ids,
      show_prices: input.showPrices,
      prices_valid_until: input.showPrices ? input.pricesValidUntil : null,
      expires_at: new Date(Date.now() + CATALOGUE_LINK_DAYS * 24 * 3600 * 1000).toISOString(),
    })
    .select('token')
    .single();
  if (error || !data) return { error: error?.message ?? "L'envoi n'a pas pu être enregistré." };

  const url = `${absoluteOrigin()}/c/${data.token as string}`;
  const body = `${input.message.trim()}\n\n${url}\n\n${user.fullName}${user.phone ? `\n${user.phone}` : ''}\nKF Auto`;

  if (input.clientId) revalidatePath(`/clients/${input.clientId}`);
  if (input.prospectId) revalidatePath(`/prospects/${input.prospectId}`);

  if (input.channel === 'whatsapp') {
    return { url, openUrl: `https://wa.me/${toWhatsappNumber(phone)}?text=${encodeURIComponent(body)}`, copyText: body };
  }
  if (input.channel === 'email') {
    const subject = kind === 'fiche' ? 'Votre fiche véhicule KF Auto' : 'Votre catalogue KF Auto';
    const gmail = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return { url, openUrl: gmail, copyText: body };
  }
  return { url, openUrl: null, copyText: body };
}

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------
export type CatalogueSendingRow = {
  id: string;
  created_at: string;
  channel: string;
  kind: string;
  product_ids: string[];
  recipient_name: string | null;
  recipient_phone: string | null;
  recipient_email: string | null;
  opened_count: number;
  first_opened_at: string | null;
  last_opened_at: string | null;
  expires_at: string;
  show_prices: boolean;
  sender: string | null;
  models: string[];
};

export async function listCatalogueSendings(filter: { clientId?: string; prospectId?: string; limit?: number }): Promise<CatalogueSendingRow[]> {
  const supabase = await createClient();
  let q = supabase
    .from('catalogue_sendings')
    .select(
      'id, created_at, channel, kind, product_ids, recipient_name, recipient_phone, recipient_email, opened_count, first_opened_at, last_opened_at, expires_at, show_prices, profiles:created_by (full_name)'
    )
    .order('created_at', { ascending: false })
    .limit(filter.limit ?? 30);
  if (filter.clientId) q = q.eq('client_id', filter.clientId);
  if (filter.prospectId) q = q.eq('prospect_id', filter.prospectId);
  const { data } = await q;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const allIds = Array.from(new Set(rows.flatMap((r) => (r.product_ids as string[]) ?? [])));
  const { data: products } = allIds.length
    ? await supabase.from('products').select('id, designation').in('id', allIds)
    : { data: [] as { id: string; designation: string }[] };
  const names = new Map(((products ?? []) as { id: string; designation: string }[]).map((p) => [p.id, p.designation]));
  return rows.map((r) => {
    const prof = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    return {
      id: r.id as string,
      created_at: r.created_at as string,
      channel: r.channel as string,
      kind: r.kind as string,
      product_ids: (r.product_ids as string[]) ?? [],
      recipient_name: (r.recipient_name as string | null) ?? null,
      recipient_phone: (r.recipient_phone as string | null) ?? null,
      recipient_email: (r.recipient_email as string | null) ?? null,
      opened_count: Number(r.opened_count ?? 0),
      first_opened_at: (r.first_opened_at as string | null) ?? null,
      last_opened_at: (r.last_opened_at as string | null) ?? null,
      expires_at: r.expires_at as string,
      show_prices: !!r.show_prices,
      sender: ((prof as { full_name?: string } | null)?.full_name as string | undefined) ?? null,
      models: ((r.product_ids as string[]) ?? []).map((id) => names.get(id) ?? 'Modèle retiré'),
    };
  });
}

// Modèles proposés à l'envoi (catalogue actif), avec la photo principale.
export type CatalogueChoice = { id: string; designation: string; salePrice: number; photoUrl: string | null };

export async function listCatalogueChoices(): Promise<CatalogueChoice[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('products')
    .select('id, designation, sale_price, photo_url')
    .eq('is_active', true)
    .not('is_archived', 'is', true)
    .order('sale_price', { ascending: true });
  return ((data ?? []) as Array<{ id: string; designation: string; sale_price: number; photo_url: string | null }>).map((p) => ({ id: p.id, designation: p.designation, salePrice: Number(p.sale_price ?? 0), photoUrl: p.photo_url }));
}
