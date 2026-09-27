// Contrat de vente PDF — même moteur (pdf-lib) que les devis/factures et la
// fiche véhicule, pour les mêmes raisons (conflit React entre
// @react-pdf/renderer et le bundling "rsc" des routes API de Next.js).
import { PDFDocument, PDFFont, StandardFonts, rgb, RGB } from 'pdf-lib';
import { formatCFA } from '@/lib/documents/calculations';
import { urlToImageBuffer } from '@/lib/documents/pdf/storage-to-data-uri';

function t(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '';
}

function sanitizeForPdf(str: string): string {
  return str
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x00-\xFF]/g, '?');
}

interface Props {
  contract: {
    contract_number: string | null;
    sale_price: number;
    payment_terms?: string | null;
    notes?: string | null;
    created_at: string;
    commercial_signature_url?: string | null;
    client_signature_url?: string | null;
  };
  organization: {
    name: string;
    logo_url?: string | null;
    address?: string | null;
    phones?: string | null;
    rccm?: string | null;
    nif?: string | null;
    terms_and_conditions?: string | null;
  };
  client: {
    first_name?: string | null;
    last_name?: string | null;
    company_name?: string | null;
    phone?: string | null;
    address?: string | null;
    email?: string | null;
  };
  product: { designation: string; brand?: string | null; model?: string | null; reference?: string | null; sku?: string | null };
  commercial: { full_name: string; phone?: string | null };
}

const NAVY = rgb(0x1b / 255, 0x2a / 255, 0x4a / 255);
const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.5, 0.5, 0.5);

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function embedImage(pdfDoc: PDFDocument, url: string | null | undefined) {
  const result = await urlToImageBuffer(url);
  if (!result) return undefined;
  try {
    if (result.type === 'jpg') return await pdfDoc.embedJpg(result.buffer);
    if (result.type === 'png') return await pdfDoc.embedPng(result.buffer);
    return undefined;
  } catch (e) {
    console.error('[contract-pdf] image illisible, ignorée :', e instanceof Error ? e.message : e);
    return undefined;
  }
}

export async function buildContractPdf({ contract, organization, client, product, commercial }: Props): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const [logo, commercialSig, clientSig] = await Promise.all([
    embedImage(pdfDoc, organization.logo_url),
    embedImage(pdfDoc, contract.commercial_signature_url),
    embedImage(pdfDoc, contract.client_signature_url),
  ]);

  let y = PAGE_HEIGHT - MARGIN;

  function text(str: string, x: number, yPos: number, opts: { size?: number; bold?: boolean; color?: RGB } = {}) {
    if (!str) return;
    page.drawText(sanitizeForPdf(str), {
      x,
      y: yPos,
      size: opts.size ?? 10,
      font: opts.bold ? fontBold : font,
      color: opts.color ?? BLACK,
    });
  }

  // Respecte les retours à la ligne déjà présents dans le texte (conditions
  // générales saisies une ligne/un tiret par ligne, par ex.) au lieu de tout
  // fondre en un seul paragraphe continu ; chaque ligne d'origine n'est
  // re-découpée que si elle dépasse la largeur disponible.
  function paragraph(str: string, x: number, startY: number, size = 10, maxWidth = CONTENT_WIDTH) {
    const sanitized = sanitizeForPdf(str);
    const lines: string[] = [];
    for (const raw of sanitized.split('\n')) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      lines.push(...wrapText(trimmed, font, size, maxWidth));
    }
    let yy = startY;
    for (const line of lines) {
      text(line, x, yy, { size });
      yy -= size + 3;
    }
    return yy;
  }

  // En-tête
  if (logo) {
    const dims = logo.scale(1);
    const maxW = 110;
    const maxH = 45;
    const ratio = Math.min(maxW / dims.width, maxH / dims.height, 1);
    page.drawImage(logo, { x: MARGIN, y: y - dims.height * ratio, width: dims.width * ratio, height: dims.height * ratio });
  } else {
    text(t(organization.name) || 'KF Auto SARL', MARGIN, y - 12, { size: 14, bold: true });
  }
  y -= 55;

  text('CONTRAT DE VENTE DE VÉHICULE', MARGIN, y, { size: 15, bold: true, color: NAVY });
  y -= 16;
  text(`N° ${t(contract.contract_number) || '(en attente)'} — Fait le ${new Date(contract.created_at).toLocaleDateString('fr-FR')}`, MARGIN, y, { size: 9, color: GRAY });
  y -= 26;

  // Parties
  text('ENTRE LES SOUSSIGNÉS :', MARGIN, y, { size: 10, bold: true });
  y -= 16;
  y = paragraph(
    `Le vendeur : ${t(organization.name) || 'KF Auto SARL'}, ${t(organization.address)}, tél. ${t(organization.phones)}` +
      (organization.rccm ? `, RCCM ${t(organization.rccm)}` : '') +
      (organization.nif ? `, NIF ${t(organization.nif)}` : '') +
      `, représenté par ${t(commercial.full_name)}.`,
    MARGIN,
    y
  );
  y -= 8;
  const clientName = t(client.company_name) || `${t(client.first_name)} ${t(client.last_name)}`.trim();
  y = paragraph(
    `L'acheteur : ${clientName}, tél. ${t(client.phone)}${client.address ? `, ${t(client.address)}` : ''}${client.email ? `, e-mail ${t(client.email)}` : ''}.`,
    MARGIN,
    y
  );
  y -= 20;

  // Objet
  text('IL A ÉTÉ CONVENU CE QUI SUIT :', MARGIN, y, { size: 10, bold: true });
  y -= 18;

  const vehicleLabel = [product.brand, product.model].filter(Boolean).join(' ') || product.designation;
  rect(MARGIN, y, CONTENT_WIDTH, 22, NAVY);
  text('Véhicule vendu', MARGIN + 6, y - 15, { size: 9, bold: true, color: WHITE });
  y -= 22;
  const vehicleLines = [
    `Désignation : ${t(product.designation)}${vehicleLabel !== product.designation ? ` (${vehicleLabel})` : ''}`,
    product.reference ? `Référence : ${t(product.reference)}` : null,
    product.sku ? `SKU : ${t(product.sku)}` : null,
  ].filter(Boolean) as string[];
  for (const line of vehicleLines) {
    text(line, MARGIN + 6, y - 13, { size: 9.5 });
    y -= 16;
  }
  y -= 6;

  text(`Prix de vente convenu : ${formatCFA(Number(contract.sale_price || 0))}`, MARGIN, y, { size: 12, bold: true, color: NAVY });
  y -= 24;

  if (contract.payment_terms) {
    text('MODALITÉS DE PAIEMENT', MARGIN, y, { size: 10, bold: true });
    y -= 14;
    y = paragraph(t(contract.payment_terms), MARGIN, y, 9.5);
    y -= 12;
  }

  if (contract.notes) {
    text('CONDITIONS PARTICULIÈRES', MARGIN, y, { size: 10, bold: true });
    y -= 14;
    y = paragraph(t(contract.notes), MARGIN, y, 9.5);
    y -= 12;
  }

  // Conditions générales de l'organisation (garantie, immatriculation,
  // assurance...) — mêmes réglages que sur les devis/factures
  // (Settings > Organisation), affichées ici juste avant les signatures,
  // uniquement si elles ont été renseignées (champ facultatif).
  if (organization.terms_and_conditions) {
    text('CONDITIONS GÉNÉRALES', MARGIN, y, { size: 10, bold: true });
    y -= 14;
    y = paragraph(t(organization.terms_and_conditions), MARGIN, y, 9);
    y -= 12;
  }

  y -= 6;
  y = paragraph(
    "En signant ce document, les deux parties reconnaissent avoir pris connaissance des conditions ci-dessus et s'engagent à les respecter.",
    MARGIN,
    y,
    9
  );

  // Signatures — placées en bas de page, quel que soit le contenu au-dessus
  const sigTop = Math.min(y - 30, 210);
  text('Le vendeur', MARGIN, sigTop, { size: 9, bold: true });
  if (commercialSig) {
    const dims = commercialSig.scale(1);
    const ratio = Math.min(140 / dims.width, 55 / dims.height, 1);
    page.drawImage(commercialSig, { x: MARGIN, y: sigTop - 16 - dims.height * ratio, width: dims.width * ratio, height: dims.height * ratio });
  } else {
    page.drawRectangle({ x: MARGIN, y: sigTop - 70, width: 160, height: 55, borderColor: GRAY, borderWidth: 0.5 });
  }

  const clientSigX = MARGIN + CONTENT_WIDTH - 160;
  text("L'acheteur", clientSigX, sigTop, { size: 9, bold: true });
  if (clientSig) {
    const dims = clientSig.scale(1);
    const ratio = Math.min(140 / dims.width, 55 / dims.height, 1);
    page.drawImage(clientSig, { x: clientSigX, y: sigTop - 16 - dims.height * ratio, width: dims.width * ratio, height: dims.height * ratio });
  } else {
    page.drawRectangle({ x: clientSigX, y: sigTop - 70, width: 160, height: 55, borderColor: GRAY, borderWidth: 0.5 });
  }

  // Pied de page
  const footerY = MARGIN;
  const footer = sanitizeForPdf(`${t(organization.name)} ${t(organization.address) ?? ''} ${t(organization.phones) ?? ''}`.trim());
  const footerW = font.widthOfTextAtSize(footer, 7.5);
  text(footer, MARGIN + (CONTENT_WIDTH - footerW) / 2, footerY, { size: 7.5, color: GRAY });

  function rect(x: number, yTop: number, w: number, h: number, color: RGB) {
    page.drawRectangle({ x, y: yTop - h, width: w, height: h, color });
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
