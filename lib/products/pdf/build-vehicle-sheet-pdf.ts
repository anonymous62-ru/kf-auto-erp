// Fiche véhicule PDF : même moteur (pdf-lib) et mêmes raisons que pour les
// devis/factures (lib/documents/pdf/build-pdf.ts) — @react-pdf/renderer
// entre en conflit avec le bundling "rsc" des routes API de Next.js.
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
  product: {
    designation: string;
    brand?: string | null;
    model?: string | null;
    reference?: string | null;
    sku?: string | null;
    description?: string | null;
    sale_price: number;
  };
  organization: { name: string; logo_url?: string | null; phones?: string | null; address?: string | null };
  photoUrls: string[];
}

const NAVY = rgb(0x1b / 255, 0x2a / 255, 0x4a / 255);
const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.5, 0.5, 0.5);

const PAGE_WIDTH = 595.28;
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

async function embedImage(pdfDoc: PDFDocument, url: string | null | undefined) {
  const result = await urlToImageBuffer(url);
  if (!result) return undefined;
  try {
    if (result.type === 'jpg') return await pdfDoc.embedJpg(result.buffer);
    if (result.type === 'png') return await pdfDoc.embedPng(result.buffer);
    return undefined;
  } catch (e) {
    console.error('[vehicle-pdf] image illisible, ignorée :', e instanceof Error ? e.message : e);
    return undefined;
  }
}

export async function buildVehicleSheetPdf({ product, organization, photoUrls }: Props): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const logo = await embedImage(pdfDoc, organization.logo_url);
  const photos = await Promise.all(photoUrls.slice(0, 6).map((url) => embedImage(pdfDoc, url)));

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

  // En-tête
  if (logo) {
    const dims = logo.scale(1);
    const maxW = 120;
    const maxH = 50;
    const ratio = Math.min(maxW / dims.width, maxH / dims.height, 1);
    page.drawImage(logo, { x: MARGIN, y: y - dims.height * ratio, width: dims.width * ratio, height: dims.height * ratio });
  } else {
    text(t(organization.name) || 'KF Auto SARL', MARGIN, y - 14, { size: 16, bold: true });
  }
  y -= 60;

  text('FICHE VÉHICULE', MARGIN, y, { size: 16, bold: true, color: NAVY });
  y -= 24;

  // Galerie de photos (grille 3 colonnes)
  const validPhotos = photos.filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (validPhotos.length > 0) {
    const cols = 3;
    const gap = 8;
    const cellW = (CONTENT_WIDTH - gap * (cols - 1)) / cols;
    const cellH = cellW * 0.72;
    const rowsUsed = Math.ceil(validPhotos.length / cols);

    validPhotos.forEach((img, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = MARGIN + col * (cellW + gap);
      const rowTop = y - row * (cellH + gap);

      const dims = img.scale(1);
      const ratio = Math.min(cellW / dims.width, cellH / dims.height);
      const drawW = dims.width * ratio;
      const drawH = dims.height * ratio;
      // centre l'image dans sa cellule
      page.drawImage(img, {
        x: x + (cellW - drawW) / 2,
        y: rowTop - cellH + (cellH - drawH) / 2,
        width: drawW,
        height: drawH,
      });
      page.drawRectangle({ x, y: rowTop - cellH, width: cellW, height: cellH, borderColor: GRAY, borderWidth: 0.5 });
    });

    y -= rowsUsed * cellH + (rowsUsed - 1) * gap + 12;
  }

  // Bandeau titre véhicule
  rect(MARGIN, y, CONTENT_WIDTH, 26, NAVY);
  text(t(product.designation), MARGIN + 8, y - 18, { size: 12, bold: true, color: WHITE });
  y -= 26 + 12;

  const infoLines = [
    product.brand ? `Marque : ${t(product.brand)}` : null,
    product.model ? `Modèle : ${t(product.model)}` : null,
    product.reference ? `Référence : ${t(product.reference)}` : null,
    product.sku ? `SKU : ${t(product.sku)}` : null,
  ].filter(Boolean) as string[];

  for (const line of infoLines) {
    text(line, MARGIN, y, { size: 10 });
    y -= 15;
  }
  y -= 6;

  text(`Prix : ${formatCFA(Number(product.sale_price || 0))}`, MARGIN, y, { size: 13, bold: true, color: NAVY });
  y -= 24;

  if (product.description) {
    text('DESCRIPTION', MARGIN, y, { size: 9, bold: true });
    y -= 13;
    const lines = wrapText(sanitizeForPdf(t(product.description)), font, 9, CONTENT_WIDTH);
    for (const line of lines) {
      text(line, MARGIN, y, { size: 9 });
      y -= 12;
    }
  }

  // Pied de page
  const footerY = MARGIN + 12;
  const footer = sanitizeForPdf(`${t(organization.name)} ${t(organization.address) ?? ''} ${t(organization.phones) ?? ''}`.trim());
  const footerW = font.widthOfTextAtSize(footer, 7.5);
  text(footer, MARGIN + (CONTENT_WIDTH - footerW) / 2, footerY, { size: 7.5, color: GRAY });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
