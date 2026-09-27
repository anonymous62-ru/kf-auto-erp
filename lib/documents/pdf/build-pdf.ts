// Génère le PDF avec pdf-lib au lieu de @react-pdf/renderer.
//
// Pourquoi ce changement : @react-pdf/renderer construit son rendu à partir
// d'éléments React (JSX), et Next.js (App Router) compile le code d'une
// route API à travers sa propre couche interne "rsc", qui embarque SA
// PROPRE copie de React — différente de celle utilisée en interne par le
// moteur de rendu de @react-pdf/renderer (chargée, elle, via node_modules).
// Les éléments créés par notre template et ceux attendus par ce moteur
// proviennent alors de deux instances de React distinctes, ce que React
// refuse ("Minified React error #31 : objects are not valid as a React
// child") — un problème documenté et connu de cette librairie avec le App
// Router de Next.js, qui persistait même après le correctif officiellement
// recommandé (serverExternalPackages). pdf-lib ne dépend pas de React du
// tout : ce risque disparaît complètement, quelle que soit la façon dont
// Next.js bundle le code.
import { PDFDocument, PDFFont, StandardFonts, rgb, RGB } from 'pdf-lib';
import { formatCFA } from '@/lib/documents/calculations';
import { urlToImageBuffer } from '@/lib/documents/pdf/storage-to-data-uri';
import { parseDesignationLines } from '@/lib/documents/format-lines';

const LABELS: Record<string, string> = {
  proforma: 'PROFORMA',
  devis: 'DEVIS',
  facture: 'FACTURE',
  bon_livraison: 'BON DE LIVRAISON',
  recu: 'REÇU',
  avoir: 'AVOIR',
};

function t(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '';
}

// Les polices standard de pdf-lib (Helvetica) n'acceptent que l'encodage
// WinAnsi : un simple montant supérieur à 999 (espace fine insécable du
// séparateur de milliers) ou une apostrophe/tiret "intelligents" tapés
// depuis un téléphone suffisent à faire planter tout le PDF. On neutralise
// ici, une fois pour toutes, les caractères problématiques les plus
// courants avant qu'ils n'atteignent le moteur de rendu.
function sanitizeForPdf(str: string): string {
  return str
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[   ​]/g, ' ')
    .replace(/[^\x00-\xFF]/g, '?');
}

interface Item {
  designation: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

interface Props {
  document: {
    document_type: string;
    document_number: string | null;
    issue_date: string;
    due_date: string | null;
    subtotal: number;
    tax_amount: number;
    total_amount: number;
    status?: string | null;
    commercial_signature_url?: string | null;
    client_signature_url?: string | null;
  };
  organization: {
    name: string;
    logo_url?: string | null;
    bank_name?: string | null;
    bank_account?: string | null;
    rccm?: string | null;
    nif?: string | null;
    cnss_number?: string | null;
    address?: string | null;
    phones?: string | null;
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
  commercial: { full_name: string; phone?: string | null };
  items: Item[];
  qrCodeDataUrl?: string;
}

const NAVY = rgb(0x1b / 255, 0x2a / 255, 0x4a / 255);
const RED = rgb(0xc1 / 255, 0x27 / 255, 0x2d / 255);
const ORANGE = rgb(0xf7 / 255, 0x94 / 255, 0x1d / 255);
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

const PAGE_WIDTH = 595.28; // A4 en points
const PAGE_HEIGHT = 841.89;
const MARGIN = 28;
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

// Comme wrapText, mais respecte les retours à la ligne déjà présents dans le
// texte (ex : conditions générales saisies ligne par ligne, une par tiret
// "-") au lieu de tout aplatir en un seul paragraphe continu. Chaque ligne
// d'origine est re-découpée individuellement si elle dépasse la largeur
// disponible, mais deux lignes distinctes ne sont jamais fusionnées.
function wrapTextPreservingLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text) return [];
  const result: string[] = [];
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    result.push(...wrapText(trimmed, font, size, maxWidth));
  }
  return result;
}

async function embedImage(pdfDoc: PDFDocument, url: string | null | undefined) {
  const result = await urlToImageBuffer(url);
  if (!result) return undefined;
  try {
    if (result.type === 'jpg') return await pdfDoc.embedJpg(result.buffer);
    if (result.type === 'png') return await pdfDoc.embedPng(result.buffer);
    return undefined; // gif/bmp non supportés par pdf-lib
  } catch (e) {
    console.error('[pdf] image illisible, ignorée :', e instanceof Error ? e.message : e);
    return undefined;
  }
}

export async function buildDocumentPdf({ document, organization, client, commercial, items, qrCodeDataUrl }: Props): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const [logo, commercialSig, clientSig, qrImage] = await Promise.all([
    embedImage(pdfDoc, organization.logo_url),
    embedImage(pdfDoc, document.commercial_signature_url),
    embedImage(pdfDoc, document.client_signature_url),
    qrCodeDataUrl ? embedImage(pdfDoc, qrCodeDataUrl) : Promise.resolve(undefined),
  ]);

  let y = PAGE_HEIGHT - MARGIN;

  function text(str: string, x: number, yPos: number, opts: { size?: number; bold?: boolean; color?: RGB } = {}) {
    if (!str) return;
    page.drawText(sanitizeForPdf(str), {
      x,
      y: yPos,
      size: opts.size ?? 9,
      font: opts.bold ? fontBold : font,
      color: opts.color ?? BLACK,
    });
  }

  function rect(x: number, yTop: number, w: number, h: number, color: RGB) {
    page.drawRectangle({ x, y: yTop - h, width: w, height: h, color });
  }

  function border(x: number, yTop: number, w: number, h: number) {
    page.drawRectangle({ x, y: yTop - h, width: w, height: h, borderColor: BLACK, borderWidth: 0.5 });
  }

  // Bandes de couleur
  const barH = 8;
  const seg = CONTENT_WIDTH / 7;
  rect(MARGIN, y, seg * 2, barH, RED);
  rect(MARGIN + seg * 2, y, seg * 1, barH, ORANGE);
  rect(MARGIN + seg * 3, y, seg * 3, barH, NAVY);
  rect(MARGIN + seg * 6, y, seg * 1, barH, BLACK);
  y -= barH + 14;

  // En-tête : logo (ou nom) + bloc client aligné à droite
  const headerTop = y;
  if (logo) {
    const dims = logo.scale(1);
    const maxW = 130;
    const maxH = 55;
    const ratio = Math.min(maxW / dims.width, maxH / dims.height, 1);
    page.drawImage(logo, { x: MARGIN, y: headerTop - dims.height * ratio, width: dims.width * ratio, height: dims.height * ratio });
  } else {
    text(t(organization.name) || 'KF Auto SARL', MARGIN, headerTop - 12, { size: 14, bold: true });
  }

  const clientName = t(client.company_name) || `${t(client.first_name)} ${t(client.last_name)}`.trim();
  const clientLines = [
    `Client : ${clientName}`,
    `Tél : ${t(client.phone)}`,
    `Adresse : ${t(client.address)}`,
    `E-mail : ${t(client.email)}`,
  ];
  clientLines.forEach((line, i) => {
    const clean = sanitizeForPdf(line);
    const w = font.widthOfTextAtSize(clean, 9);
    text(clean, MARGIN + CONTENT_WIDTH - w, headerTop - 10 - i * 12, { size: 9 });
  });
  y = headerTop - 65;

  // Titre du document
  const label = t(LABELS[document.document_type] ?? document.document_type);
  const number = t(document.document_number) || '(en attente de synchronisation)';
  text(`${label} N° : ${number}`, MARGIN, y, { size: 12, bold: true });
  y -= 20;

  // Tableau infos
  const infoColW = CONTENT_WIDTH / 4;
  const infoHeaders = ['Date', 'Échéance', 'Nom du vendeur', 'Numéro du vendeur'];
  const infoValues = [t(document.issue_date), t(document.due_date) || '-', t(commercial.full_name), t(commercial.phone)];
  const infoRowH = 18;
  infoHeaders.forEach((h, i) => {
    rect(MARGIN + i * infoColW, y, infoColW, infoRowH, NAVY);
    border(MARGIN + i * infoColW, y, infoColW, infoRowH);
    text(h, MARGIN + i * infoColW + 4, y - 12, { size: 8, bold: true, color: WHITE });
  });
  y -= infoRowH;
  infoValues.forEach((v, i) => {
    border(MARGIN + i * infoColW, y, infoColW, infoRowH);
    text(v, MARGIN + i * infoColW + 4, y - 12, { size: 8 });
  });
  y -= infoRowH + 14;

  // Tableau des lignes
  const colWidths = [CONTENT_WIDTH * 0.4, CONTENT_WIDTH * 0.15, CONTENT_WIDTH * 0.225, CONTENT_WIDTH * 0.225];
  const colX = [MARGIN, MARGIN + colWidths[0], MARGIN + colWidths[0] + colWidths[1], MARGIN + colWidths[0] + colWidths[1] + colWidths[2]];
  const rowH = 18;
  const tableTop = y;
  // Lignes horizontales du quadrillage : une entrée par frontière de ligne
  // (départ du tableau, puis bas de chaque ligne dessinée). Permet de
  // reproduire le tableau entièrement quadrillé du modèle papier, plutôt
  // qu'un simple cadre englobant.
  const rowBoundaries: number[] = [tableTop];

  function itemsHeaderRow(labels: string[]) {
    labels.forEach((l, i) => {
      rect(colX[i], y, colWidths[i], rowH, NAVY);
      text(l, colX[i] + 4, y - 12, { size: 8, bold: true, color: WHITE });
    });
    y -= rowH;
    rowBoundaries.push(y);
  }
  function itemsRow(values: string[], bold = false) {
    values.forEach((v, i) => {
      text(v, colX[i] + 4, y - 12, { size: 8, bold });
    });
    y -= rowH;
    rowBoundaries.push(y);
  }

  // Ligne d'article à hauteur variable : la désignation peut être un simple
  // libellé, ou un texte multi-ligne (caractéristiques du produit, avec des
  // titres de section en MAJUSCULES et des puces "-", comme sur le modèle
  // papier d'origine). On mesure d'abord le nombre de lignes nécessaires
  // (après retour à la ligne dans la colonne description), puis on dessine
  // la ligne complète à cette hauteur — Qté/PU/Montant restent alignés en
  // haut de la ligne, sur la première ligne de texte.
  const descColWidth = colWidths[0] - 8;
  const itemLineHeight = 9.5;

  function itemRow(item: Item) {
    const parsed = parseDesignationLines(sanitizeForPdf(t(item.designation)));
    const wrapped: { text: string; bold: boolean }[] = [];
    for (const line of parsed.length > 0 ? parsed : [{ text: '', bold: false }]) {
      const subLines = wrapText(line.text, line.bold ? fontBold : font, 8, descColWidth);
      for (const sub of subLines.length > 0 ? subLines : ['']) {
        wrapped.push({ text: sub, bold: line.bold });
      }
    }
    const rowHeight = Math.max(rowH, wrapped.length * itemLineHeight + 8);
    const rowTop = y;

    wrapped.forEach((line, i) => {
      text(line.text, colX[0] + 4, rowTop - 12 - i * itemLineHeight, { size: 8, bold: line.bold });
    });
    const values = [
      Number(item.quantity || 0).toFixed(2),
      formatCFA(Number(item.unit_price || 0)),
      formatCFA(Number(item.line_total || 0)),
    ];
    values.forEach((v, i) => {
      text(v, colX[i + 1] + 4, rowTop - 12, { size: 8 });
    });
    y -= rowHeight;
    rowBoundaries.push(y);
  }

  itemsHeaderRow(['Description', 'Qté', 'PU hors taxes', 'Montant hors taxes']);
  for (const item of items) {
    itemRow(item);
  }
  itemsRow(['Prix HT', '', '', formatCFA(Number(document.subtotal || 0))], true);
  itemsRow(['TVA', '', '', Number(document.tax_amount || 0) > 0 ? formatCFA(Number(document.tax_amount)) : 'NA'], true);
  itemsRow(['Montant total net', '', '', formatCFA(Number(document.total_amount || 0))], true);

  // Tableau entièrement quadrillé (lignes horizontales à chaque frontière de
  // ligne + lignes verticales entre chaque colonne), comme sur le modèle
  // papier d'origine, plutôt qu'un simple cadre englobant.
  const tableBottom = y;
  for (const yLine of rowBoundaries) {
    page.drawLine({
      start: { x: MARGIN, y: yLine },
      end: { x: MARGIN + CONTENT_WIDTH, y: yLine },
      thickness: 0.5,
      color: BLACK,
    });
  }
  const colLines = [MARGIN, ...colX.slice(1), MARGIN + CONTENT_WIDTH];
  for (const xLine of colLines) {
    page.drawLine({
      start: { x: xLine, y: tableTop },
      end: { x: xLine, y: tableBottom },
      thickness: 0.5,
      color: BLACK,
    });
  }
  y -= 14;

  // Conditions générales : affichées tant que le document n'est pas
  // intégralement payé. Une fois le client payé, elles n'ont plus lieu
  // d'être rappelées sur le document (garantie/mode de paiement/délais
  // deviennent caducs une fois la transaction soldée).
  const isPaid = t(document.status) === 'paye';
  if (!isPaid && t(organization.terms_and_conditions)) {
    text('CONDITIONS GÉNÉRALES', MARGIN, y, { size: 8, bold: true });
    y -= 11;
    const lines = wrapTextPreservingLines(sanitizeForPdf(t(organization.terms_and_conditions)), font, 7.5, CONTENT_WIDTH);
    for (const line of lines) {
      text(line, MARGIN, y, { size: 7.5 });
      y -= 10;
    }
    y -= 10;
  }

  // Signatures + QR code
  const sigTop = y;
  text('Signature commerciale', MARGIN, sigTop, { size: 8 });
  if (commercialSig) {
    const dims = commercialSig.scale(1);
    const ratio = Math.min(100 / dims.width, 40 / dims.height, 1);
    page.drawImage(commercialSig, { x: MARGIN, y: sigTop - 12 - dims.height * ratio, width: dims.width * ratio, height: dims.height * ratio });
  }
  const clientSigX = MARGIN + CONTENT_WIDTH / 2;
  text('Signature du client', clientSigX, sigTop, { size: 8 });
  if (clientSig) {
    const dims = clientSig.scale(1);
    const ratio = Math.min(100 / dims.width, 40 / dims.height, 1);
    page.drawImage(clientSig, { x: clientSigX, y: sigTop - 12 - dims.height * ratio, width: dims.width * ratio, height: dims.height * ratio });
  }
  if (qrImage) {
    const dims = qrImage.scale(1);
    const size = 46;
    page.drawImage(qrImage, { x: MARGIN + CONTENT_WIDTH - size, y: sigTop - size, width: size, height: (size * dims.height) / dims.width });
  }

  // Pied de page : logo (rappelé ici comme sur le modèle papier), puis
  // coordonnées bancaires/légales, puis bande tricolore en bas de page
  // (symétrique de celle du haut).
  const footerY = MARGIN + 24;
  page.drawLine({ start: { x: MARGIN, y: footerY + 12 }, end: { x: MARGIN + CONTENT_WIDTH, y: footerY + 12 }, thickness: 0.5, color: BLACK });
  if (logo) {
    const dims = logo.scale(1);
    const logoH = 16;
    const ratio = logoH / dims.height;
    page.drawImage(logo, { x: MARGIN, y: footerY - 12, width: dims.width * ratio, height: logoH });
  }
  const footerLine1 = [
    t(organization.bank_name),
    t(organization.bank_account),
    t(organization.rccm) ? `N° RCCM : ${t(organization.rccm)}` : '',
    t(organization.nif) ? `NIF : ${t(organization.nif)}` : '',
    t(organization.cnss_number) ? `N°CNSS : ${t(organization.cnss_number)}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const footerLine2 = sanitizeForPdf(`${t(organization.name)} ${t(organization.address)} ${t(organization.phones)}`.trim());
  const footerLine1Clean = sanitizeForPdf(footerLine1);
  text(footerLine1Clean, MARGIN + (CONTENT_WIDTH - font.widthOfTextAtSize(footerLine1Clean, 6.5)) / 2, footerY, { size: 6.5 });
  text(footerLine2, MARGIN + (CONTENT_WIDTH - font.widthOfTextAtSize(footerLine2, 6.5)) / 2, footerY - 9, { size: 6.5 });

  // Bande tricolore de bas de page (identique à celle du haut)
  const bottomBarH = 8;
  rect(MARGIN, bottomBarH, seg * 2, bottomBarH, RED);
  rect(MARGIN + seg * 2, bottomBarH, seg * 1, bottomBarH, ORANGE);
  rect(MARGIN + seg * 3, bottomBarH, seg * 3, bottomBarH, NAVY);
  rect(MARGIN + seg * 6, bottomBarH, seg * 1, bottomBarH, BLACK);

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
