// Catalogue PDF (direction, 10/10/2026), généré avec pdf-lib comme les
// proformas et factures, et avec la même identité : logo KF Auto, bandes
// rouge / orange / bleu marine / noir, pied de page avec RCCM, NIF et
// adresse.
//
// Deux formats :
//   - « fiche » : un modèle sur 2 pages (photo, points forts, fiche
//     technique, équipements, garantie, couleurs, conseiller) ;
//   - « gamme » : couverture, sommaire, une page par modèle, page finale
//     après-vente / garantie / contacts.
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb, RGB } from 'pdf-lib';
import { formatCFA } from '@/lib/documents/calculations';
import { urlToImageBuffer } from '@/lib/documents/pdf/storage-to-data-uri';
import { parseDesignationLines } from '@/lib/documents/format-lines';
import { sanitizeForPdf } from '@/lib/documents/pdf/build-pdf';
import { WARRANTY_TEXT } from '@/lib/catalogue/roles';
import type { CatalogueModel, CatalogueOrganization, CatalogueSender } from '@/lib/catalogue/data';

const NAVY = rgb(0x1b / 255, 0x2a / 255, 0x4a / 255);
const RED = rgb(0xc1 / 255, 0x27 / 255, 0x2d / 255);
const ORANGE = rgb(0xf7 / 255, 0x94 / 255, 0x1d / 255);
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const INK = rgb(0x1f / 255, 0x29 / 255, 0x37 / 255);
const MUTED = rgb(0x6b / 255, 0x72 / 255, 0x80 / 255);
const LINE = rgb(0xe5 / 255, 0xe7 / 255, 0xeb / 255);
const PANEL = rgb(0xf7 / 255, 0xf8 / 255, 0xfa / 255);

const W = 595.28;
const H = 841.89;
const M = 36;
const CW = W - M * 2;
const TOP = H - M - 22; // sous la bande du haut
const BOTTOM = M + 52; // au-dessus du pied de page
const CONTENT_TOP = TOP - 50; // pages avec le petit logo en tête

export type CatalogueOptions = {
  kind: 'fiche' | 'gamme';
  showPrices: boolean;
  pricesValidUntil: string | null; // AAAA-MM-JJ
  recipientName: string | null;
  date: Date;
};

type Ctx = {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  logo?: PDFImage;
  org: CatalogueOrganization;
  sender: CatalogueSender;
  opts: CatalogueOptions;
};

type Section = { title: string; items: string[] };

function s(value: string | null | undefined) {
  // Exposants (cm³) mal rendus par la police standard : écrits en clair.
  return sanitizeForPdf((value ?? '').replace(/³/g, '3').replace(/²/g, '2'));
}

function frDate(iso: string | null | undefined) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

function todayFr(date: Date) {
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Africa/Lome' });
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const clean = s(text).replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const words = clean.split(' ');
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

// Fiche technique : sections en MAJUSCULES suivies de puces, comme sur les
// proformas (même parseur que les lignes de document).
export function parseSpecSections(description: string | null | undefined): Section[] {
  const sections: Section[] = [];
  for (const line of parseDesignationLines(description ?? '')) {
    if (line.bold) {
      sections.push({ title: line.text.replace(/\s*:\s*$/, ''), items: [] });
    } else {
      if (sections.length === 0) sections.push({ title: 'CARACTÉRISTIQUES', items: [] });
      sections[sections.length - 1].items.push(line.text.replace(/^[-•]\s*/, ''));
    }
  }
  return sections.filter((x) => x.items.length > 0);
}

async function embed(doc: PDFDocument, url: string | null | undefined) {
  const result = await urlToImageBuffer(url);
  if (!result) return undefined;
  try {
    if (result.type === 'jpg') return await doc.embedJpg(result.buffer);
    if (result.type === 'png') return await doc.embedPng(result.buffer);
  } catch (e) {
    console.error('[catalogue] image illisible, ignorée :', e instanceof Error ? e.message : e);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Primitives de dessin
// ---------------------------------------------------------------------------
function text(page: PDFPage, ctx: Ctx, str: string, x: number, y: number, size = 9, opts: { bold?: boolean; color?: RGB } = {}) {
  const clean = s(str);
  if (!clean) return;
  page.drawText(clean, { x, y, size, font: opts.bold ? ctx.bold : ctx.font, color: opts.color ?? INK });
}

function textRight(page: PDFPage, ctx: Ctx, str: string, xRight: number, y: number, size = 9, opts: { bold?: boolean; color?: RGB } = {}) {
  const clean = s(str);
  const f = opts.bold ? ctx.bold : ctx.font;
  text(page, ctx, clean, xRight - f.widthOfTextAtSize(clean, size), y, size, opts);
}

function textCenter(page: PDFPage, ctx: Ctx, str: string, y: number, size = 9, opts: { bold?: boolean; color?: RGB } = {}) {
  const clean = s(str);
  const f = opts.bold ? ctx.bold : ctx.font;
  text(page, ctx, clean, (W - f.widthOfTextAtSize(clean, size)) / 2, y, size, opts);
}

function box(page: PDFPage, x: number, yTop: number, w: number, h: number, color: RGB) {
  page.drawRectangle({ x, y: yTop - h, width: w, height: h, color });
}

function outline(page: PDFPage, x: number, yTop: number, w: number, h: number, color = LINE) {
  page.drawRectangle({ x, y: yTop - h, width: w, height: h, borderColor: color, borderWidth: 0.75 });
}

// Image entière dans un cadre (fond gris clair), centrée.
function imageContain(page: PDFPage, img: PDFImage | undefined, x: number, yTop: number, w: number, h: number) {
  box(page, x, yTop, w, h, PANEL);
  if (!img) return;
  const ratio = Math.min(w / img.width, h / img.height);
  const iw = img.width * ratio;
  const ih = img.height * ratio;
  page.drawImage(img, { x: x + (w - iw) / 2, y: yTop - h + (h - ih) / 2, width: iw, height: ih });
}

function sectionTitle(page: PDFPage, ctx: Ctx, title: string, x: number, y: number) {
  box(page, x, y + 8, 3, 10, RED);
  text(page, ctx, title.toUpperCase(), x + 8, y, 9, { bold: true, color: NAVY });
}

// Puces sur une colonne ; renvoie le nouveau y. S'arrête au bas de la zone.
function bullets(page: PDFPage, ctx: Ctx, items: string[], x: number, y: number, width: number, size = 8.5, floor = BOTTOM) {
  for (const item of items) {
    const lines = wrap(item, ctx.font, size, width - 10);
    if (y - lines.length * (size + 3) < floor) {
      text(page, ctx, '...', x + 10, y, size, { color: MUTED });
      return y - (size + 3);
    }
    box(page, x + 1, y + size * 0.62, 3, 3, NAVY);
    lines.forEach((l, i) => text(page, ctx, l, x + 10, y - i * (size + 3), size));
    y -= lines.length * (size + 3) + 2;
  }
  return y;
}

// Sections de fiche technique réparties sur deux colonnes.
function specColumns(page: PDFPage, ctx: Ctx, sections: Section[], yStart: number, floor: number, size = 8.5) {
  const gap = 18;
  const colW = (CW - gap) / 2;
  // Répartition équilibrée par nombre de lignes estimé.
  const weights = sections.map((sec) => 2 + sec.items.reduce((n, it) => n + wrap(it, ctx.font, size, colW - 10).length, 0));
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  let split = sections.length;
  for (let i = 0; i < sections.length; i++) {
    acc += weights[i];
    if (acc >= total / 2) {
      split = i + 1;
      break;
    }
  }
  const columns = [sections.slice(0, split), sections.slice(split)];
  let lowest = yStart;
  columns.forEach((col, ci) => {
    const x = M + ci * (colW + gap);
    let y = yStart;
    for (const sec of col) {
      if (y - 30 < floor) break;
      sectionTitle(page, ctx, sec.title, x, y);
      y -= 16;
      y = bullets(page, ctx, sec.items, x, y, colW, size, floor);
      y -= 8;
    }
    lowest = Math.min(lowest, y);
  });
  return lowest;
}

function priceBlock(page: PDFPage, ctx: Ctx, model: CatalogueModel, xRight: number, y: number) {
  if (!ctx.opts.showPrices || !(model.salePrice > 0)) return;
  textRight(page, ctx, formatCFA(model.salePrice), xRight, y, 15, { bold: true, color: NAVY });
  if (ctx.opts.pricesValidUntil) {
    textRight(page, ctx, `Prix valable jusqu'au ${frDate(ctx.opts.pricesValidUntil)}`, xRight, y - 13, 7.5, { color: MUTED });
  }
}

function advisorBox(page: PDFPage, ctx: Ctx, x: number, yTop: number, w: number) {
  const h = 74;
  outline(page, x, yTop, w, h);
  text(page, ctx, 'VOTRE CONSEILLER', x + 12, yTop - 17, 8, { bold: true, color: RED });
  text(page, ctx, ctx.sender.full_name || s(ctx.org.name), x + 12, yTop - 33, 11, { bold: true, color: NAVY });
  const lines = [
    ctx.sender.phone ? `Téléphone et WhatsApp : ${ctx.sender.phone}` : ctx.org.phones ? `Téléphone : ${ctx.org.phones}` : '',
    ctx.sender.email ? `E-mail : ${ctx.sender.email}` : '',
  ].filter(Boolean);
  lines.forEach((l, i) => text(page, ctx, l, x + 12, yTop - 49 - i * 12, 8.5));
  return yTop - h;
}

function warrantyBox(page: PDFPage, ctx: Ctx, x: number, yTop: number, w: number) {
  const h = 74;
  box(page, x, yTop, w, h, NAVY);
  text(page, ctx, 'GARANTIE', x + 12, yTop - 17, 8, { bold: true, color: ORANGE });
  text(page, ctx, WARRANTY_TEXT, x + 12, yTop - 35, 13, { bold: true, color: WHITE });
  const sub = wrap("Au premier des deux termes atteint, selon les conditions du constructeur. Entretien et pièces d'origine dans notre atelier.", ctx.font, 8, w - 24);
  sub.forEach((l, i) => text(page, ctx, l, x + 12, yTop - 50 - i * 10, 8, { color: WHITE }));
  return yTop - h;
}

// Bandes, en-tête discret et pied de page légal, posés une fois toutes les
// pages créées (numérotation).
function decorate(ctx: Ctx, page: PDFPage, index: number, total: number, showHeader: boolean) {
  const seg = CW / 7;
  const barH = 6;
  const topY = H - M + 14;
  box(page, M, topY, seg * 2, barH, RED);
  box(page, M + seg * 2, topY, seg, barH, ORANGE);
  box(page, M + seg * 3, topY, seg * 3, barH, NAVY);
  box(page, M + seg * 6, topY, seg, barH, BLACK);

  if (showHeader && ctx.logo) {
    const lh = 22;
    const ratio = lh / ctx.logo.height;
    page.drawImage(ctx.logo, { x: M, y: TOP - lh + 6, width: ctx.logo.width * ratio, height: lh });
  }

  const footerY = M + 22;
  page.drawLine({ start: { x: M, y: footerY + 12 }, end: { x: M + CW, y: footerY + 12 }, thickness: 0.5, color: LINE });
  const line1 = [
    ctx.org.rccm ? `RCCM : ${ctx.org.rccm}` : '',
    ctx.org.nif ? `NIF : ${ctx.org.nif}` : '',
    ctx.org.cnss_number ? `CNSS : ${ctx.org.cnss_number}` : '',
    ctx.org.bank_name && ctx.org.bank_account ? `${ctx.org.bank_name} ${ctx.org.bank_account}` : '',
  ]
    .filter(Boolean)
    .join('   ');
  const line2 = [ctx.org.name, [ctx.org.address, ctx.org.city].filter(Boolean).join(', '), ctx.org.phones, ctx.org.email]
    .filter(Boolean)
    .join('   ');
  textCenter(page, ctx, line1, footerY, 6.5, { color: MUTED });
  textCenter(page, ctx, line2, footerY - 9, 6.5, { color: MUTED });
  textRight(page, ctx, `${index + 1} / ${total}`, M + CW, footerY + 18, 7, { color: MUTED });

  const bottomY = M - 8;
  box(page, M, bottomY, seg * 2, barH, RED);
  box(page, M + seg * 2, bottomY, seg, barH, ORANGE);
  box(page, M + seg * 3, bottomY, seg * 3, barH, NAVY);
  box(page, M + seg * 6, bottomY, seg, barH, BLACK);
}

// ---------------------------------------------------------------------------
// Fiche modèle : 2 pages
// ---------------------------------------------------------------------------
async function drawModelSheet(ctx: Ctx, model: CatalogueModel) {
  const images = await Promise.all(model.photos.slice(0, 4).map((p) => embed(ctx.doc, p.url)));

  // Page 1 : présentation
  const p1 = ctx.doc.addPage([W, H]);
  let y = TOP;
  if (ctx.logo) {
    const lh = 40;
    const ratio = Math.min(lh / ctx.logo.height, 150 / ctx.logo.width);
    p1.drawImage(ctx.logo, { x: M, y: y - ctx.logo.height * ratio + 4, width: ctx.logo.width * ratio, height: ctx.logo.height * ratio });
  } else {
    text(p1, ctx, ctx.org.name, M, y - 14, 14, { bold: true, color: NAVY });
  }
  textRight(p1, ctx, 'FICHE MODÈLE', M + CW, y - 6, 8, { bold: true, color: RED });
  textRight(p1, ctx, todayFr(ctx.opts.date), M + CW, y - 18, 8, { color: MUTED });
  y -= 62;

  const priceW = ctx.opts.showPrices && model.salePrice > 0 ? 170 : 0;
  const titleLines = wrap(model.designation, ctx.bold, 22, CW - priceW - 10);
  titleLines.forEach((l, i) => text(p1, ctx, l, M, y - i * 25, 22, { bold: true, color: NAVY }));
  priceBlock(p1, ctx, model, M + CW, y);
  y -= titleLines.length * 25;
  if (model.tagline) {
    wrap(model.tagline, ctx.font, 11, CW - priceW - 10).forEach((l) => {
      text(p1, ctx, l, M, y, 11, { color: MUTED });
      y -= 14;
    });
  }
  y -= 10;

  imageContain(p1, images[0], M, y, CW, 300);
  y -= 300 + 8;
  const thumbs = images.slice(1, 4);
  if (thumbs.length > 0) {
    const gap = 8;
    const tw = (CW - gap * 2) / 3;
    thumbs.forEach((img, i) => imageContain(p1, img, M + i * (tw + gap), y, tw, 92));
    y -= 92 + 22;
  } else {
    y -= 14;
  }

  if (model.highlights.length > 0) {
    sectionTitle(p1, ctx, 'Points forts', M, y);
    y -= 18;
    const gap = 18;
    const colW = (CW - gap) / 2;
    const half = Math.ceil(model.highlights.length / 2);
    const yA = bullets(p1, ctx, model.highlights.slice(0, half), M, y, colW, 9.5);
    const yB = bullets(p1, ctx, model.highlights.slice(half), M + colW + gap, y, colW, 9.5);
    y = Math.min(yA, yB) - 6;
  }
  if (model.colors && y - 40 > BOTTOM) {
    sectionTitle(p1, ctx, 'Couleurs disponibles', M, y);
    y -= 16;
    wrap(model.colors, ctx.font, 9, CW).forEach((l) => {
      text(p1, ctx, l, M, y, 9);
      y -= 12;
    });
  }

  // Page 2 : fiche technique, équipements, garantie, conseiller
  const p2 = ctx.doc.addPage([W, H]);
  y = CONTENT_TOP;
  text(p2, ctx, model.designation, M, y, 14, { bold: true, color: NAVY });
  textRight(p2, ctx, 'Caractéristiques et équipements', M + CW, y, 8.5, { color: MUTED });
  y -= 10;
  p2.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.75, color: LINE });
  y -= 22;

  const boxesTop = BOTTOM + 74 + 10;
  const sections = parseSpecSections(model.description);
  if (model.equipment.length > 0) sections.push({ title: 'ÉQUIPEMENTS', items: model.equipment });
  if (sections.length > 0) {
    y = specColumns(p2, ctx, sections, y, boxesTop + 30);
  } else {
    text(p2, ctx, 'Fiche technique disponible sur demande auprès de votre conseiller.', M, y, 9, { color: MUTED });
  }

  const boxW = (CW - 12) / 2;
  warrantyBox(p2, ctx, M, boxesTop, boxW);
  advisorBox(p2, ctx, M + boxW + 12, boxesTop, boxW);
}

// ---------------------------------------------------------------------------
// Catalogue gamme
// ---------------------------------------------------------------------------
async function drawCover(ctx: Ctx, models: CatalogueModel[]) {
  const page = ctx.doc.addPage([W, H]);
  let y = TOP - 10;
  if (ctx.logo) {
    const lh = 64;
    const ratio = Math.min(lh / ctx.logo.height, 220 / ctx.logo.width);
    const lw = ctx.logo.width * ratio;
    page.drawImage(ctx.logo, { x: (W - lw) / 2, y: y - ctx.logo.height * ratio, width: lw, height: ctx.logo.height * ratio });
    y -= ctx.logo.height * ratio + 34;
  } else {
    textCenter(page, ctx, ctx.org.name, y - 20, 20, { bold: true, color: NAVY });
    y -= 60;
  }

  const brands = Array.from(new Set(models.map((m) => (m.brand ?? '').trim()).filter(Boolean)));
  const title = brands.length === 1 ? `Gamme ${brands[0]}` : 'Nos véhicules';
  textCenter(page, ctx, 'CATALOGUE', y, 9, { bold: true, color: RED });
  y -= 34;
  textCenter(page, ctx, title, y, 32, { bold: true, color: NAVY });
  y -= 22;
  textCenter(page, ctx, `${models.length} modèle${models.length > 1 ? 's' : ''}   ${todayFr(ctx.opts.date)}`, y, 10, { color: MUTED });
  y -= 26;

  const hero = await embed(ctx.doc, models.find((m) => m.photos.length > 0)?.photos[0]?.url);
  imageContain(page, hero, M, y, CW, 330);
  y -= 330 + 30;

  if (ctx.opts.recipientName) {
    textCenter(page, ctx, 'Préparé pour', y, 9, { color: MUTED });
    y -= 18;
    textCenter(page, ctx, ctx.opts.recipientName, y, 15, { bold: true, color: INK });
    y -= 26;
  }
  if (ctx.sender.full_name) {
    const line = `Votre conseiller : ${ctx.sender.full_name}${ctx.sender.phone ? `   ${ctx.sender.phone}` : ''}`;
    textCenter(page, ctx, line, y, 10, { color: NAVY });
  }
}

function drawContents(ctx: Ctx, models: CatalogueModel[], firstModelPage: number) {
  const page = ctx.doc.addPage([W, H]);
  let y = CONTENT_TOP;
  text(page, ctx, 'Sommaire', M, y, 22, { bold: true, color: NAVY });
  y -= 14;
  page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.75, color: LINE });
  y -= 30;

  models.forEach((m, i) => {
    if (y < BOTTOM + 60) return;
    const pageNo = firstModelPage + i;
    text(page, ctx, String(i + 1).padStart(2, '0'), M, y, 11, { bold: true, color: RED });
    text(page, ctx, m.designation, M + 30, y, 11, { bold: true, color: INK });
    textRight(page, ctx, `page ${pageNo}`, M + CW, y, 9, { color: MUTED });
    let y2 = y - 14;
    if (m.tagline) {
      text(page, ctx, wrap(m.tagline, ctx.font, 9, CW - 200)[0] ?? '', M + 30, y2, 9, { color: MUTED });
    }
    if (ctx.opts.showPrices && m.salePrice > 0) {
      textRight(page, ctx, formatCFA(m.salePrice), M + CW, y2, 9.5, { bold: true, color: NAVY });
    }
    y2 -= 12;
    page.drawLine({ start: { x: M, y: y2 }, end: { x: M + CW, y: y2 }, thickness: 0.5, color: LINE });
    y = y2 - 22;
  });

  if (ctx.opts.showPrices && ctx.opts.pricesValidUntil) {
    text(page, ctx, `Prix en FCFA, valables jusqu'au ${frDate(ctx.opts.pricesValidUntil)}.`, M, Math.max(y - 4, BOTTOM + 20), 8.5, {
      color: MUTED,
    });
  }
}

async function drawModelPage(ctx: Ctx, model: CatalogueModel) {
  const page = ctx.doc.addPage([W, H]);
  const images = await Promise.all(model.photos.slice(0, 3).map((p) => embed(ctx.doc, p.url)));
  let y = CONTENT_TOP;

  const priceW = ctx.opts.showPrices && model.salePrice > 0 ? 170 : 0;
  const titleLines = wrap(model.designation, ctx.bold, 20, CW - priceW - 10);
  titleLines.forEach((l, i) => text(page, ctx, l, M, y - i * 23, 20, { bold: true, color: NAVY }));
  priceBlock(page, ctx, model, M + CW, y);
  y -= titleLines.length * 23;
  if (model.tagline) {
    wrap(model.tagline, ctx.font, 10.5, CW - priceW - 10)
      .slice(0, 2)
      .forEach((l) => {
        text(page, ctx, l, M, y, 10.5, { color: MUTED });
        y -= 13;
      });
  }
  y -= 8;

  imageContain(page, images[0], M, y, CW, 250);
  y -= 250 + 8;
  const thumbs = images.slice(1, 3);
  if (thumbs.length > 0) {
    const tw = (CW - 8) / 2;
    thumbs.forEach((img, i) => imageContain(page, img, M + i * (tw + 8), y, tw, 78));
    y -= 78 + 22;
  } else {
    y -= 12;
  }

  const floor = BOTTOM + 26;
  const gap = 18;
  const colW = (CW - gap) / 2;
  const sections = parseSpecSections(model.description);
  const hasLeft = model.highlights.length > 0 || model.equipment.length > 0 || !!model.colors;
  if (!hasLeft) {
    // Pas de texte commercial : la fiche technique prend toute la largeur.
    if (sections.length > 0) specColumns(page, ctx, sections, y, floor, 8);
    box(page, M, floor - 2, 3, 10, RED);
    text(page, ctx, WARRANTY_TEXT, M + 8, floor - 10, 8.5, { bold: true, color: NAVY });
    return;
  }
  let yLeft = y;
  if (model.highlights.length > 0) {
    sectionTitle(page, ctx, 'Points forts', M, yLeft);
    yLeft = bullets(page, ctx, model.highlights, M, yLeft - 16, colW, 8.5, floor) - 8;
  }
  if (model.equipment.length > 0 && yLeft - 30 > floor) {
    sectionTitle(page, ctx, 'Équipements', M, yLeft);
    yLeft = bullets(page, ctx, model.equipment, M, yLeft - 16, colW, 8.5, floor) - 8;
  }
  if (model.colors && yLeft - 30 > floor) {
    sectionTitle(page, ctx, 'Couleurs', M, yLeft);
    yLeft -= 16;
    wrap(model.colors, ctx.font, 8.5, colW).forEach((l) => {
      text(page, ctx, l, M, yLeft, 8.5);
      yLeft -= 11;
    });
  }

  // Colonne droite : fiche technique condensée.
  const xR = M + colW + gap;
  let yRight = y;
  for (const sec of sections) {
    if (yRight - 30 < floor) break;
    sectionTitle(page, ctx, sec.title, xR, yRight);
    yRight = bullets(page, ctx, sec.items, xR, yRight - 16, colW, 8, floor) - 6;
  }

  box(page, M, floor - 2, 3, 10, RED);
  text(page, ctx, WARRANTY_TEXT, M + 8, floor - 10, 8.5, { bold: true, color: NAVY });
}

function drawClosingPage(ctx: Ctx) {
  const page = ctx.doc.addPage([W, H]);
  let y = CONTENT_TOP;
  text(page, ctx, 'Après-vente, garantie et contacts', M, y, 20, { bold: true, color: NAVY });
  y -= 14;
  page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.75, color: LINE });
  y -= 30;

  const blocks: { title: string; lines: string[] }[] = [
    {
      title: 'Garantie',
      lines: [
        `${WARRANTY_TEXT} sur nos véhicules neufs, au premier des deux termes atteint, selon les conditions du constructeur.`,
      ],
    },
    {
      title: 'Atelier et entretien',
      lines: [
        "Entretien périodique et réparations réalisés dans notre atelier, avec des pièces de rechange d'origine.",
        'Prise de rendez-vous auprès de votre conseiller ou de notre accueil après-vente.',
      ],
    },
    {
      title: 'Nous trouver',
      lines: [
        [ctx.org.name, [ctx.org.address, ctx.org.city].filter(Boolean).join(', ')].filter(Boolean).join(', '),
        ctx.org.phones ? `Téléphone : ${ctx.org.phones}` : '',
        ctx.org.email ? `E-mail : ${ctx.org.email}` : '',
      ].filter(Boolean),
    },
  ];

  for (const b of blocks) {
    sectionTitle(page, ctx, b.title, M, y);
    y -= 18;
    for (const line of b.lines) {
      wrap(line, ctx.font, 10, CW - 10).forEach((l) => {
        text(page, ctx, l, M + 8, y, 10);
        y -= 14;
      });
    }
    y -= 16;
  }

  if (ctx.opts.showPrices && ctx.opts.pricesValidUntil) {
    text(page, ctx, `Prix en FCFA, valables jusqu'au ${frDate(ctx.opts.pricesValidUntil)}, dans la limite des stocks disponibles.`, M, y, 9, {
      color: MUTED,
    });
    y -= 26;
  }

  const boxW = (CW - 12) / 2;
  const top = Math.min(y, BOTTOM + 74 + 120);
  warrantyBox(page, ctx, M, top, boxW);
  advisorBox(page, ctx, M + boxW + 12, top, boxW);
}

// ---------------------------------------------------------------------------
export async function buildCataloguePdf(input: {
  models: CatalogueModel[];
  organization: CatalogueOrganization;
  sender: CatalogueSender;
  options: CatalogueOptions;
}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(sanitizeForPdf(input.options.kind === 'fiche' ? input.models[0]?.designation ?? 'Fiche modèle' : 'Catalogue'));
  doc.setAuthor(sanitizeForPdf(input.organization.name));
  const [font, bold, logo] = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
    embed(doc, input.organization.logo_url),
  ]);
  const ctx: Ctx = { doc, font, bold, logo, org: input.organization, sender: input.sender, opts: input.options };

  const headerless = new Set<number>();
  if (input.options.kind === 'fiche' || input.models.length === 1) {
    await drawModelSheet(ctx, input.models[0]);
    headerless.add(0);
  } else {
    await drawCover(ctx, input.models);
    headerless.add(0);
    drawContents(ctx, input.models, 3);
    for (const m of input.models) await drawModelPage(ctx, m);
    drawClosingPage(ctx);
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => decorate(ctx, p, i, pages.length, !headerless.has(i)));

  return Buffer.from(await doc.save());
}
