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
import { PDFDocument, PDFFont, PDFImage, StandardFonts, degrees, rgb, RGB } from 'pdf-lib';
import { formatCFA } from '@/lib/documents/calculations';
import { urlToImageBuffer } from '@/lib/documents/pdf/storage-to-data-uri';
import { parseDesignationLines } from '@/lib/documents/format-lines';
import { DOCUMENT_PRINT_TITLES } from '@/lib/documents/labels';
import { resolveShortSpecs } from '@/lib/products/short-specs';

const LABELS: Record<string, string> = DOCUMENT_PRINT_TITLES;

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
export function sanitizeForPdf(str: string): string {
  return str
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    // Exposants (cm³, m²) : présents dans l'encodage, mais absents des
    // polices de substitution de nombreux lecteurs PDF (affichés en blanc).
    .replace(/³/g, '3')
    .replace(/²/g, '2')
    .replace(/[   ​]/g, ' ')
    .replace(/[^\x00-\xFF]/g, '?');
}

interface Item {
  designation: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  // Facture simplifiée (migration 0050) : nom du modèle et caractéristiques
  // courtes du produit lié à la ligne. Utilisés seulement sur la facture et
  // l'avoir ; la proforma et le bon de commande impriment la désignation
  // complète (fiche détaillée).
  product_designation?: string | null;
  product_description?: string | null;
  product_short_specs?: string | null;
}

// Véhicule identifié sur une facture (document_item_vehicles -> vehicle_units).
export interface PdfVehicle {
  model: string;
  color?: string | null;
  vin?: string | null;
  engine_number?: string | null;
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
    // Avoir : « Avoir sur la facture FAC-... Motif : ... ».
    reference_note?: string | null;
    commercial_signature_url?: string | null;
    client_signature_url?: string | null;
    // Date de signature du client (documents.signed_at).
    client_signed_at?: string | null;
    // Signature du responsable commercial (N+1), migration 0043.
    n1_signature_url?: string | null;
    n1_signer_name?: string | null;
    n1_signed_at?: string | null;
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
    client_number?: string | null;
  };
  commercial: { full_name: string; phone?: string | null };
  items: Item[];
  // Facture / avoir : véhicules livrés (modèle, couleur, châssis, moteur).
  vehicles?: PdfVehicle[];
  qrCodeDataUrl?: string;
}

const NAVY = rgb(0x1b / 255, 0x2a / 255, 0x4a / 255);
const RED = rgb(0xc1 / 255, 0x27 / 255, 0x2d / 255);
const ORANGE = rgb(0xf7 / 255, 0x94 / 255, 0x1d / 255);
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const GREY = rgb(0.45, 0.45, 0.45);
const LIGHT = rgb(0.75, 0.75, 0.75);

const PAGE_WIDTH = 595.28; // A4 en points
const PAGE_HEIGHT = 841.89;
const MARGIN = 28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
// Le contenu ne descend jamais sous cette limite : en dessous se trouvent le
// pied de page (coordonnées bancaires/légales) et la bande tricolore.
const CONTENT_BOTTOM = MARGIN + 46;

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

// "2026-11-17" ou un horodatage ISO -> "17/11/2026".
function formatDateFr(value: string | null | undefined): string {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value);
}

// Désignation imprimée sur la facture simplifiée : le nom du modèle en titre,
// puis les caractéristiques courtes (jamais la fiche technique complète).
function simplifiedDesignation(item: Item): string {
  const lines = t(item.designation).split('\n');
  const firstLine = lines[0]?.trim() ?? '';
  const rest = lines.slice(1).join('\n');
  const isDetailed = lines.filter((l) => l.trim()).length > 1;
  const hasProductSpecs = !!t(item.product_short_specs).trim();
  if (!isDetailed && !hasProductSpecs) return t(item.designation);
  const title = firstLine || t(item.product_designation);
  const specs = resolveShortSpecs(item.product_short_specs, t(item.product_description) || rest);
  return specs ? `${title}\n${specs}` : title;
}

export async function buildDocumentPdf({ document, organization, client, commercial, items, vehicles, qrCodeDataUrl }: Props): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const isProforma = document.document_type === 'devis' || document.document_type === 'proforma';
  const isInvoiceLike = document.document_type === 'facture' || document.document_type === 'avoir';

  const [logo, commercialSig, clientSig, n1Sig, qrImage] = await Promise.all([
    embedImage(pdfDoc, organization.logo_url),
    embedImage(pdfDoc, document.commercial_signature_url),
    embedImage(pdfDoc, document.client_signature_url),
    isProforma ? embedImage(pdfDoc, document.n1_signature_url) : Promise.resolve(undefined),
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

  function border(x: number, yTop: number, w: number, h: number, color: RGB = BLACK) {
    page.drawRectangle({ x, y: yTop - h, width: w, height: h, borderColor: color, borderWidth: 0.5 });
  }

  const barH = 8;
  const seg = CONTENT_WIDTH / 7;
  function colorBar(yTop: number) {
    rect(MARGIN, yTop, seg * 2, barH, RED);
    rect(MARGIN + seg * 2, yTop, seg * 1, barH, ORANGE);
    rect(MARGIN + seg * 3, yTop, seg * 3, barH, NAVY);
    rect(MARGIN + seg * 6, yTop, seg * 1, barH, BLACK);
  }

  const label = t(LABELS[document.document_type] ?? document.document_type);
  const number = t(document.document_number) || '(en attente de synchronisation)';

  // Page suivante (documents longs : plusieurs véhicules, fiche détaillée,
  // conditions générales) : bande de couleur et rappel du numéro.
  function newPage() {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    colorBar(y);
    y -= barH + 14;
    text(`${label} N° : ${number} (suite)`, MARGIN, y, { size: 10, bold: true });
    y -= 18;
  }

  // Vrai si la page a été changée.
  function ensureSpace(h: number): boolean {
    if (y - h >= CONTENT_BOTTOM) return false;
    newPage();
    return true;
  }

  // Bandes de couleur
  colorBar(y);
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
    `Client : ${clientName}${client.client_number ? ` (N° ${t(client.client_number)})` : ''}`,
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
  text(`${label} N° : ${number}`, MARGIN, y, { size: 12, bold: true });

  // Sécurité des factures : une facture annulée ne doit jamais pouvoir passer
  // pour une facture valable.
  const watermark = !isInvoiceLike
    ? ''
    : t(document.status) === 'annule'
    ? 'ANNULÉE'
    : '';
  const stamp =
    isInvoiceLike && t(document.status) === 'annule'
      ? document.document_type === 'avoir'
        ? 'AVOIR ANNULÉ'
        : 'FACTURE ANNULÉE'
      : '';
  if (stamp) {
    const clean = sanitizeForPdf(stamp);
    const w = fontBold.widthOfTextAtSize(clean, 10);
    text(clean, MARGIN + CONTENT_WIDTH - w, y, { size: 10, bold: true, color: RED });
  }
  y -= 20;

  if (t(document.reference_note)) {
    const noteLines = wrapTextPreservingLines(sanitizeForPdf(t(document.reference_note)), font, 9, CONTENT_WIDTH);
    for (const line of noteLines) {
      text(line, MARGIN, y, { size: 9 });
      y -= 12;
    }
    y -= 6;
  }

  // Tableau infos
  const infoColW = CONTENT_WIDTH / 4;
  const infoHeaders = ['Date', 'Échéance', 'Nom du vendeur', 'Numéro du vendeur'];
  const infoValues = [formatDateFr(document.issue_date), formatDateFr(document.due_date) || '-', t(commercial.full_name), t(commercial.phone)];
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

  // Tableau quadrillé générique (lignes horizontales à chaque frontière de
  // ligne + lignes verticales entre colonnes), comme sur le modèle papier.
  // Si le tableau ne tient pas sur la page, il est refermé, puis repris sur
  // la page suivante avec son en-tête.
  function makeGrid(colWidths: number[], headerLabels: string[]) {
    const colX = colWidths.map((_, i) => MARGIN + colWidths.slice(0, i).reduce((a, b) => a + b, 0));
    const rowH = 18;
    let top = y;
    let boundaries: number[] = [];

    function header() {
      top = y;
      boundaries = [y];
      headerLabels.forEach((l, i) => {
        rect(colX[i], y, colWidths[i], rowH, NAVY);
        text(l, colX[i] + 4, y - 12, { size: 8, bold: true, color: WHITE });
      });
      y -= rowH;
      boundaries.push(y);
    }

    function close() {
      for (const yLine of boundaries) {
        page.drawLine({ start: { x: MARGIN, y: yLine }, end: { x: MARGIN + CONTENT_WIDTH, y: yLine }, thickness: 0.5, color: BLACK });
      }
      for (const xLine of [...colX, MARGIN + CONTENT_WIDTH]) {
        page.drawLine({ start: { x: xLine, y: top }, end: { x: xLine, y }, thickness: 0.5, color: BLACK });
      }
    }

    // Réserve la hauteur d'une ligne : change de page (en refermant le
    // tableau en cours) si elle ne tient pas.
    function reserve(h: number) {
      if (y - h >= CONTENT_BOTTOM) return;
      close();
      newPage();
      header();
    }

    function push() {
      boundaries.push(y);
    }

    return { colX, colWidths, rowH, header, close, reserve, push };
  }

  // Tableau des lignes
  const items$ = makeGrid(
    [CONTENT_WIDTH * 0.4, CONTENT_WIDTH * 0.15, CONTENT_WIDTH * 0.225, CONTENT_WIDTH * 0.225],
    ['Description', 'Qté', 'PU hors taxes', 'Montant hors taxes']
  );

  function itemsRow(values: string[], bold = false) {
    items$.reserve(items$.rowH);
    values.forEach((v, i) => {
      text(v, items$.colX[i] + 4, y - 12, { size: 8, bold });
    });
    y -= items$.rowH;
    items$.push();
  }

  // Ligne d'article à hauteur variable : la désignation peut être un simple
  // libellé, ou un texte multi-ligne (caractéristiques du produit, avec des
  // titres de section en MAJUSCULES et des puces "-", comme sur le modèle
  // papier d'origine). On mesure d'abord le nombre de lignes nécessaires
  // (après retour à la ligne dans la colonne description), puis on dessine
  // la ligne complète à cette hauteur. Qté/PU/Montant restent alignés en
  // haut de la ligne, sur la première ligne de texte.
  //
  // Facture / avoir : désignation simplifiée (nom du modèle en gras +
  // caractéristiques courtes), au lieu de la fiche technique complète.
  const descColWidth = items$.colWidths[0] - 8;
  const itemLineHeight = 9.5;

  function itemRow(item: Item) {
    const designation = isInvoiceLike ? simplifiedDesignation(item) : t(item.designation);
    const parsed = parseDesignationLines(sanitizeForPdf(designation));
    if (isInvoiceLike && parsed.length > 0) parsed[0] = { ...parsed[0], bold: true };
    const wrapped: { text: string; bold: boolean; indent: number }[] = [];
    for (const line of parsed.length > 0 ? parsed : [{ text: '', bold: false }]) {
      // Facture : la suite d'une puce trop longue est alignée sous son texte.
      const hanging = isInvoiceLike && line.text.startsWith('-') ? 7 : 0;
      const lineFont = line.bold ? fontBold : font;
      const norm = line.text.replace(/\s+/g, ' ');
      const first = wrapText(norm, lineFont, 8, descColWidth)[0] ?? '';
      const rest = norm.slice(first.length).trim();
      const subLines = hanging && rest ? [first, ...wrapText(rest, lineFont, 8, descColWidth - hanging)] : wrapText(line.text, lineFont, 8, descColWidth);
      (subLines.length > 0 ? subLines : ['']).forEach((sub, k) => {
        wrapped.push({ text: sub, bold: line.bold, indent: k > 0 ? hanging : 0 });
      });
    }
    const values = [
      Number(item.quantity || 0).toFixed(2),
      formatCFA(Number(item.unit_price || 0)),
      formatCFA(Number(item.line_total || 0)),
    ];

    // Une fiche détaillée plus haute que la place restante est découpée en
    // morceaux, sur plusieurs pages ; les montants restent sur le premier.
    let start = 0;
    let first = true;
    while (start < wrapped.length || first) {
      const available = Math.floor((y - CONTENT_BOTTOM - 8) / itemLineHeight);
      const remaining = wrapped.length - start;
      if (available < Math.min(remaining, 4)) {
        items$.reserve(PAGE_HEIGHT); // force le changement de page
        continue;
      }
      const count = Math.max(1, Math.min(remaining, available));
      const chunk = wrapped.slice(start, start + count);
      const rowHeight = Math.max(items$.rowH, chunk.length * itemLineHeight + 8);
      const rowTop = y;
      chunk.forEach((line, i) => {
        text(line.text, items$.colX[0] + 4 + line.indent, rowTop - 12 - i * itemLineHeight, { size: 8, bold: line.bold });
      });
      if (first) {
        values.forEach((v, i) => {
          text(v, items$.colX[i + 1] + 4, rowTop - 12, { size: 8 });
        });
      }
      y -= rowHeight;
      items$.push();
      start += count;
      first = false;
    }
  }

  items$.header();
  for (const item of items) {
    itemRow(item);
  }
  itemsRow(['Prix HT', '', '', formatCFA(Number(document.subtotal || 0))], true);
  itemsRow(['TVA', '', '', Number(document.tax_amount || 0) > 0 ? formatCFA(Number(document.tax_amount)) : 'NA'], true);
  itemsRow(['Montant total net', '', '', formatCFA(Number(document.total_amount || 0))], true);
  items$.close();
  y -= 14;

  // Facture / avoir : identification des véhicules (modèle, couleur, numéro
  // de châssis, numéro moteur), un véhicule par ligne.
  const vehicleList = isInvoiceLike ? vehicles ?? [] : [];
  if (vehicleList.length > 0) {
    ensureSpace(14 + 18 * 2);
    text(vehicleList.length > 1 ? 'IDENTIFICATION DES VÉHICULES' : 'IDENTIFICATION DU VÉHICULE', MARGIN, y, { size: 8, bold: true });
    y -= 6;
    const v$ = makeGrid(
      [CONTENT_WIDTH * 0.34, CONTENT_WIDTH * 0.18, CONTENT_WIDTH * 0.26, CONTENT_WIDTH * 0.22],
      ['Modèle', 'Couleur', 'N° de châssis', 'N° moteur']
    );
    v$.header();
    for (const v of vehicleList) {
      const cells = [t(v.model), t(v.color) || '-', t(v.vin) || '-', t(v.engine_number) || '-'].map((c, i) =>
        wrapText(sanitizeForPdf(c), font, 8, v$.colWidths[i] - 8)
      );
      const lineCount = Math.max(1, ...cells.map((c) => c.length));
      const rowHeight = Math.max(v$.rowH, lineCount * itemLineHeight + 8);
      v$.reserve(rowHeight);
      const rowTop = y;
      cells.forEach((lines, i) => {
        lines.forEach((line, j) => text(line, v$.colX[i] + 4, rowTop - 12 - j * itemLineHeight, { size: 8 }));
      });
      y -= rowHeight;
      v$.push();
    }
    v$.close();
    y -= 14;
  }

  // Conditions générales : affichées tant que le document n'est pas
  // intégralement payé. Une fois le client payé, elles n'ont plus lieu
  // d'être rappelées sur le document (garantie/mode de paiement/délais
  // deviennent caducs une fois la transaction soldée).
  const isPaid = t(document.status) === 'paye';
  if (!isPaid && t(organization.terms_and_conditions)) {
    ensureSpace(11 + 10 * 2);
    text('CONDITIONS GÉNÉRALES', MARGIN, y, { size: 8, bold: true });
    y -= 11;
    const lines = wrapTextPreservingLines(sanitizeForPdf(t(organization.terms_and_conditions)), font, 7.5, CONTENT_WIDTH);
    for (const line of lines) {
      ensureSpace(10);
      text(line, MARGIN, y, { size: 7.5 });
      y -= 10;
    }
    y -= 10;
  }

  function drawSignatureImage(img: PDFImage | undefined, x: number, yTop: number, maxW: number, maxH: number) {
    if (!img) return;
    const dims = img.scale(1);
    const ratio = Math.min(maxW / dims.width, maxH / dims.height, 1);
    page.drawImage(img, { x, y: yTop - dims.height * ratio, width: dims.width * ratio, height: dims.height * ratio });
  }

  const qrSize = 46;
  if (isProforma) {
    // Proforma : trois cadres de signature (commercial, responsable
    // commercial N+1, client), avec nom et date quand ils sont connus. Un
    // cadre reste vide tant que la personne n'a pas signé.
    const boxH = 84;
    ensureSpace(boxH + 4);
    const sigTop = y;
    const gap = 8;
    const boxW = (CONTENT_WIDTH - qrSize - gap * 3) / 3;
    const boxes = [
      { title: 'Le commercial', img: commercialSig, name: t(commercial.full_name), date: '' },
      {
        title: 'Le responsable commercial (N+1)',
        img: n1Sig,
        name: n1Sig || document.n1_signed_at ? t(document.n1_signer_name) : '',
        date: formatDateFr(document.n1_signed_at),
      },
      { title: 'Le client', img: clientSig, name: clientName, date: formatDateFr(document.client_signed_at) },
    ];
    boxes.forEach((b, i) => {
      const x = MARGIN + i * (boxW + gap);
      border(x, sigTop, boxW, boxH, LIGHT);
      const title = wrapText(sanitizeForPdf(b.title), fontBold, 7.5, boxW - 8)[0] ?? '';
      text(title, x + 4, sigTop - 10, { size: 7.5, bold: true });
      drawSignatureImage(b.img, x + 4, sigTop - 15, boxW - 8, 40);
      const nameLine = wrapText(sanitizeForPdf(b.name ? `Nom : ${b.name}` : 'Nom :'), font, 7, boxW - 8)[0] ?? '';
      text(nameLine, x + 4, sigTop - boxH + 16, { size: 7, color: b.name ? BLACK : GREY });
      text(b.date ? `Date : ${b.date}` : 'Date :', x + 4, sigTop - boxH + 6, { size: 7, color: b.date ? BLACK : GREY });
    });
    if (qrImage) {
      const dims = qrImage.scale(1);
      page.drawImage(qrImage, { x: MARGIN + CONTENT_WIDTH - qrSize, y: sigTop - qrSize, width: qrSize, height: (qrSize * dims.height) / dims.width });
    }
    y = sigTop - boxH - 6;
  } else {
    // Bon de commande, facture, avoir : signatures commerciale et client.
    ensureSpace(qrSize + 6);
    const sigTop = y;
    text('Signature commerciale', MARGIN, sigTop, { size: 8 });
    drawSignatureImage(commercialSig, MARGIN, sigTop - 12, 100, 40);
    const clientSigX = MARGIN + CONTENT_WIDTH / 2;
    text('Signature du client', clientSigX, sigTop, { size: 8 });
    drawSignatureImage(clientSig, clientSigX, sigTop - 12, 100, 40);
    if (qrImage) {
      const dims = qrImage.scale(1);
      page.drawImage(qrImage, { x: MARGIN + CONTENT_WIDTH - qrSize, y: sigTop - qrSize, width: qrSize, height: (qrSize * dims.height) / dims.width });
    }
    y = sigTop - qrSize - 6;
  }

  // Pied de page de chaque page : logo (rappelé ici comme sur le modèle
  // papier), coordonnées bancaires/légales, bande tricolore en bas de page
  // (symétrique de celle du haut), numéro de page si plusieurs pages.
  const footerY = MARGIN + 24;
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
  const pages = pdfDoc.getPages();
  pages.forEach((p, index) => {
    page = p;
    page.drawLine({ start: { x: MARGIN, y: footerY + 12 }, end: { x: MARGIN + CONTENT_WIDTH, y: footerY + 12 }, thickness: 0.5, color: BLACK });
    if (logo) {
      const dims = logo.scale(1);
      const logoH = 16;
      const ratio = logoH / dims.height;
      page.drawImage(logo, { x: MARGIN, y: footerY - 12, width: dims.width * ratio, height: logoH });
    }
    text(footerLine1Clean, MARGIN + (CONTENT_WIDTH - font.widthOfTextAtSize(footerLine1Clean, 6.5)) / 2, footerY, { size: 6.5 });
    text(footerLine2, MARGIN + (CONTENT_WIDTH - font.widthOfTextAtSize(footerLine2, 6.5)) / 2, footerY - 9, { size: 6.5 });
    if (pages.length > 1) {
      const pn = `Page ${index + 1}/${pages.length}`;
      text(pn, MARGIN + CONTENT_WIDTH - font.widthOfTextAtSize(pn, 6.5), footerY - 9, { size: 6.5, color: GREY });
    }
    colorBar(barH);

    // Filigrane dessiné en dernier, par-dessus les tableaux.
    if (watermark) {
      const big = sanitizeForPdf(watermark);
      const bigSize = 90;
      const bigW = fontBold.widthOfTextAtSize(big, bigSize);
      page.drawText(big, {
        x: PAGE_WIDTH / 2 - (bigW / 2) * Math.cos(Math.PI / 6),
        y: PAGE_HEIGHT / 2 - (bigW / 2) * Math.sin(Math.PI / 6),
        size: bigSize,
        font: fontBold,
        color: RED,
        opacity: 0.1,
        rotate: degrees(30),
      });
    }
  });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
