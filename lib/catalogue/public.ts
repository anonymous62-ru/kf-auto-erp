// Lien public d'un catalogue (/c/<jeton>) : lecture avec la clé serveur,
// accès uniquement par le jeton aléatoire, refus après expiration. Utilisé
// par la page publique et par la route PDF publique, jamais par le navigateur.
import { createAdminClient } from '@/lib/supabase/admin';
import { buildCataloguePdf } from '@/lib/catalogue/pdf/build-catalogue-pdf';
import { loadCatalogueModels, loadCatalogueOrganization, loadCatalogueSender } from '@/lib/catalogue/data';

export type PublicSending = {
  id: string;
  organization_id: string;
  created_by: string;
  kind: 'fiche' | 'gamme';
  product_ids: string[];
  show_prices: boolean;
  prices_valid_until: string | null;
  recipient_name: string | null;
  expires_at: string;
  opened_count: number;
  created_at: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findSendingByToken(token: string): Promise<{ sending: PublicSending | null; expired: boolean }> {
  if (!UUID.test(token)) return { sending: null, expired: false };
  const admin = createAdminClient();
  const { data } = await admin
    .from('catalogue_sendings')
    .select('id, organization_id, created_by, kind, product_ids, show_prices, prices_valid_until, recipient_name, expires_at, opened_count, created_at')
    .eq('token', token)
    .maybeSingle();
  if (!data) return { sending: null, expired: false };
  const sending = data as PublicSending;
  return { sending, expired: new Date(sending.expires_at).getTime() < Date.now() };
}

// Les aperçus de lien (WhatsApp, Facebook, robots) ne comptent pas comme une
// ouverture par le client.
export function isLinkPreviewBot(userAgent: string | null) {
  return /whatsapp|facebookexternalhit|facebot|bot\b|bot\/|crawler|spider|preview|slack|telegram|discord|skype|curl|wget/i.test(
    userAgent ?? ''
  );
}

export async function recordCatalogueOpen(sending: PublicSending, userAgent: string | null) {
  if (isLinkPreviewBot(userAgent)) return;
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const first = sending.opened_count === 0;
  await admin
    .from('catalogue_sendings')
    .update({
      opened_count: sending.opened_count + 1,
      last_opened_at: now,
      ...(first ? { first_opened_at: now } : {}),
    })
    .eq('id', sending.id);
  if (first) {
    await admin.from('notifications').insert({
      organization_id: sending.organization_id,
      user_id: sending.created_by,
      type: 'catalogue_ouvert',
      title: 'Catalogue consulté',
      message: `${sending.recipient_name || 'Votre contact'} vient d'ouvrir le catalogue que vous avez envoyé.`,
    });
  }
}

export async function renderPublicCataloguePdf(sending: PublicSending) {
  const admin = createAdminClient();
  const [models, organization, sender] = await Promise.all([
    loadCatalogueModels(admin, sending.organization_id, sending.product_ids),
    loadCatalogueOrganization(admin, sending.organization_id),
    loadCatalogueSender(admin, sending.created_by),
  ]);
  if (models.length === 0) return null;
  const buffer = await buildCataloguePdf({
    models,
    organization,
    sender,
    options: {
      kind: sending.kind,
      showPrices: sending.show_prices,
      pricesValidUntil: sending.prices_valid_until,
      recipientName: sending.recipient_name,
      date: new Date(sending.created_at),
    },
  });
  const base = sending.kind === 'fiche' ? models[0].designation : 'Catalogue KF Auto';
  const filename = `${base.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-') || 'catalogue'}.pdf`;
  return { buffer, filename, models, organization, sender };
}
