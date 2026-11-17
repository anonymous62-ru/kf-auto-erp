// PDF imprimable d'une fiche de réception / restitution SAV (pdf-lib, comme
// lib/documents/pdf/build-pdf.ts). Les images (signature, photos) sont lues
// dans le bucket privé avec la session de l'utilisateur : la RLS décide.
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb, RGB } from 'pdf-lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizeForPdf } from '@/lib/documents/pdf/build-pdf';
import {
  ACCESSORIES,
  INSPECTION_BUCKET,
  INSPECTION_COLUMNS,
  INSPECTION_KIND_LABELS,
  WARNING_LIGHTS,
  compareInspections,
  damageLabel,
  formatKm,
  fuelLabel,
  labelOf,
  normalizeChecklist,
  zoneLabel,
  type InspectionKind,
  type InspectionRow,
} from '@/lib/atelier/inspection-config';

const NAVY = rgb(0x1b / 255, 0x2a / 255, 0x4a / 255);
const RED = rgb(0xc1 / 255, 0x27 / 255, 0x2d / 255);
const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.42, 0.42, 0.42);
const LIGHT = rgb(0.85, 0.85, 0.85);
const RED_BG = rgb(0.99, 0.92, 0.92);

const W = 595.28;
const H = 841.89;
const M = 36;
const CW = W - M * 2;
const BOTTOM = M + 20;

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const raw of sanitizeForPdf(text || '').split('\n')) {
    const words = raw.split(/\s+/).filter(Boolean);
    let cur = '';
    for (const w of words) {
      const cand = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(cand, size) > maxWidth && cur) {
        out.push(cur);
        cur = w;
      } else cur = cand;
    }
    out.push(cur);
  }
  return out;
}

function fmt(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Lome' });
}

async function download(supabase: SupabaseClient, path: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  const { data } = await supabase.storage.from(INSPECTION_BUCKET).download(path);
  if (!data) return null;
  return { bytes: new Uint8Array(await data.arrayBuffer()), type: data.type || '' };
}

async function embed(pdf: PDFDocument, file: { bytes: Uint8Array; type: string } | null): Promise<PDFImage | null> {
  if (!file) return null;
  try {
    const b = file.bytes;
    const isPng = b[0] === 0x89 && b[1] === 0x50;
    const isJpg = b[0] === 0xff && b[1] === 0xd8;
    if (isPng) return await pdf.embedPng(b);
    if (isJpg) return await pdf.embedJpg(b);
  } catch {
    // image illisible : ignorée
  }
  return null; // HEIC, WebP : non pris en charge par pdf-lib
}

export async function renderInspectionPdf(
  supabase: SupabaseClient,
  repairOrderId: string,
  kind: InspectionKind
): Promise<{ buffer: Buffer; filename: string } | null> {
  const { data: order } = await supabase
    .from('repair_orders')
    .select('id, organization_id, order_number, vehicle_label, vehicle_plate, vehicle_vin, clients(first_name, last_name, company_name, phone)')
    .eq('id', repairOrderId)
    .maybeSingle();
  if (!order) return null;

  const { data: rows } = await supabase.from('vehicle_inspections').select(INSPECTION_COLUMNS).eq('repair_order_id', repairOrderId);
  const all = (rows ?? []).map((r) => {
    const row = r as unknown as InspectionRow;
    return { ...row, checklist: normalizeChecklist(row.checklist), photos: row.photos ?? [] };
  });
  const ins = all.find((r) => r.kind === kind);
  if (!ins) return null;
  const entry = all.find((r) => r.kind === 'reception') ?? null;

  const { data: org } = await supabase
    .from('organizations')
    .select('name, address, phones')
    .eq('id', order.organization_id)
    .maybeSingle();

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const text = (s: string, x: number, size = 9, f: PDFFont = font, color: RGB = BLACK) => {
    page.drawText(sanitizeForPdf(s), { x, y, size, font: f, color });
  };
  const ensure = (needed: number) => {
    if (y - needed < BOTTOM) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };
  const para = (s: string, x = M, size = 9, f: PDFFont = font, color: RGB = BLACK, width = CW) => {
    for (const line of wrap(s, f, size, width - (x - M))) {
      ensure(size + 4);
      text(line, x, size, f, color);
      y -= size + 3;
    }
  };
  const heading = (s: string) => {
    ensure(28);
    y -= 8;
    text(s.toUpperCase(), M, 9.5, bold, NAVY);
    y -= 4;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LIGHT });
    y -= 12;
  };

  // ---------- En-tête ----------
  const orgName = (org?.name as string | undefined) ?? 'KF Auto';
  text(orgName, M, 13, bold, NAVY);
  const title = INSPECTION_KIND_LABELS[kind].toUpperCase();
  page.drawText(sanitizeForPdf(title), { x: W - M - bold.widthOfTextAtSize(title, 13), y, size: 13, font: bold, color: NAVY });
  y -= 14;
  const orgLine = [org?.address, org?.phones].filter(Boolean).join(' - ');
  if (orgLine) {
    text(String(orgLine), M, 8, font, GREY);
  }
  const orLine = `Ordre de réparation ${order.order_number ?? ''}`;
  page.drawText(sanitizeForPdf(orLine), { x: W - M - font.widthOfTextAtSize(orLine, 9), y, size: 9, font, color: GREY });
  y -= 18;

  const client = order.clients as { first_name?: string; last_name?: string; company_name?: string; phone?: string } | null;
  const clientName = client ? client.company_name || [client.first_name, client.last_name].filter(Boolean).join(' ') : '';

  const pairs: [string, string][] = [
    ['Client', [clientName, client?.phone].filter(Boolean).join(' - ') || 'Non renseigné'],
    ['Véhicule', [order.vehicle_label, order.vehicle_plate].filter(Boolean).join(' - ') || 'Non précisé'],
    ['Châssis (VIN)', (order.vehicle_vin as string | null) || 'Non renseigné'],
    ['Réceptionnaire', ins.receptionist_name || 'Non renseigné'],
    ['Date et heure', fmt(ins.inspected_at)],
    ['Kilométrage', formatKm(ins.mileage)],
    ['Carburant', fuelLabel(ins.fuel_level)],
  ];
  for (const [k, v] of pairs) {
    ensure(14);
    text(k, M, 9, font, GREY);
    text(v, M + 110, 9, bold);
    y -= 13;
  }

  // Jauge carburant
  ensure(16);
  for (let i = 0; i < 9; i++) {
    const filled = ins.fuel_level !== null && i <= ins.fuel_level;
    page.drawRectangle({ x: M + 110 + i * 15, y: y - 2, width: 13, height: 8, color: filled ? NAVY : LIGHT });
  }
  y -= 16;

  // ---------- Comparaison ----------
  if (kind === 'restitution' && entry) {
    const cmp = compareInspections(entry, ins);
    heading('Comparaison entrée / sortie');
    const lines: { label: string; a: string; b: string; bad: boolean; note?: string }[] = [
      {
        label: 'Kilométrage',
        a: formatKm(entry.mileage),
        b: formatKm(ins.mileage),
        bad: false,
        note: cmp.distanceKm !== null ? `Parcourus : ${formatKm(cmp.distanceKm)}` : undefined,
      },
      { label: 'Carburant', a: fuelLabel(entry.fuel_level), b: fuelLabel(ins.fuel_level), bad: cmp.fuelDropped, note: cmp.fuelDropped ? 'Niveau plus bas qu\'à l\'entrée' : undefined },
      {
        label: 'Voyants',
        a: (entry.checklist.warning_lights ?? []).map((k) => labelOf(WARNING_LIGHTS, k)).join(', ') || 'Aucun',
        b: (ins.checklist.warning_lights ?? []).map((k) => labelOf(WARNING_LIGHTS, k)).join(', ') || 'Aucun',
        bad: cmp.newWarningLights.length > 0,
        note: cmp.newWarningLights.length ? `Nouveau : ${cmp.newWarningLights.map((k) => labelOf(WARNING_LIGHTS, k)).join(', ')}` : undefined,
      },
      {
        label: 'Accessoires',
        a: `${(entry.checklist.accessories ?? []).length} présent(s)`,
        b: `${(ins.checklist.accessories ?? []).length} présent(s)`,
        bad: cmp.missingAccessories.length > 0,
        note: cmp.missingAccessories.length ? `Manquant : ${cmp.missingAccessories.map((k) => labelOf(ACCESSORIES, k)).join(', ')}` : undefined,
      },
      {
        label: 'Carrosserie',
        a: `${(entry.checklist.body_damages ?? []).length} dégât(s)`,
        b: `${(ins.checklist.body_damages ?? []).length} dégât(s)`,
        bad: cmp.newDamages.length > 0,
        note: cmp.newDamages.length
          ? `Nouveau : ${cmp.newDamages.map((d) => `${zoneLabel(d.zone)} (${damageLabel(d.type)})`).join(', ')}`
          : undefined,
      },
    ];
    ensure(14);
    text('Entrée', M + 110, 8, bold, GREY);
    text('Sortie', M + 300, 8, bold, GREY);
    y -= 12;
    for (const l of lines) {
      const aLines = wrap(l.a, font, 8.5, 180);
      const bLines = wrap(l.b, font, 8.5, CW - 264);
      const nLines = l.note ? wrap(l.note, font, 8, CW - 264) : [];
      const h = Math.max(aLines.length, bLines.length + nLines.length) * 11 + 6;
      ensure(h);
      if (l.bad) page.drawRectangle({ x: M - 4, y: y - h + 10, width: CW + 8, height: h, color: RED_BG });
      text(l.label, M, 8.5, bold);
      const top = y;
      aLines.forEach((s, i) => page.drawText(s, { x: M + 110, y: top - i * 11, size: 8.5, font, color: BLACK }));
      bLines.forEach((s, i) => page.drawText(s, { x: M + 300, y: top - i * 11, size: 8.5, font: l.bad ? bold : font, color: l.bad ? RED : BLACK }));
      nLines.forEach((s, i) =>
        page.drawText(s, { x: M + 300, y: top - (bLines.length + i) * 11, size: 8, font, color: l.bad ? RED : GREY })
      );
      y -= h;
    }
  }

  // ---------- Liste de contrôle ----------
  const c = ins.checklist;
  heading('Carrosserie et rayures');
  if ((c.body_damages ?? []).length === 0) para(c.body_ok ? 'Aucun dégât visible.' : 'Aucun dégât relevé.');
  for (const d of c.body_damages ?? []) {
    para(`- ${zoneLabel(d.zone)} : ${damageLabel(d.type)}${d.comment ? `, ${d.comment}` : ''}`);
  }

  heading('Voyants allumés au tableau de bord');
  para(
    (c.warning_lights ?? []).length
      ? (c.warning_lights ?? [])
          .map((k) => (k === 'autre' && c.warning_lights_other ? `Autre (${c.warning_lights_other})` : labelOf(WARNING_LIGHTS, k)))
          .join(', ')
      : 'Aucun voyant allumé.'
  );

  heading('Accessoires');
  for (const a of ACCESSORIES) {
    if (a.key === 'autre' && !(c.accessories ?? []).includes('autre')) continue;
    const present = (c.accessories ?? []).includes(a.key);
    ensure(12);
    page.drawRectangle({ x: M, y: y - 1, width: 8, height: 8, borderColor: GREY, borderWidth: 0.7, color: present ? NAVY : undefined });
    const label = a.key === 'autre' && c.accessories_other ? `Autre : ${c.accessories_other}` : a.label;
    text(`${label}${present ? '' : ' (absent)'}`, M + 14, 8.5, font, present ? BLACK : GREY);
    y -= 12;
  }

  heading('Observations');
  para(ins.observations || 'Aucune observation.');

  // ---------- Photos (JPEG / PNG uniquement) ----------
  if (ins.photos.length > 0) {
    heading(`Photos (${ins.photos.length})`);
    const images = (await Promise.all(ins.photos.slice(0, 12).map(async (p) => embed(pdf, await download(supabase, p))))).filter(
      (i): i is PDFImage => !!i
    );
    const cell = (CW - 3 * 8) / 4;
    for (let i = 0; i < images.length; i++) {
      const col = i % 4;
      if (col === 0) ensure(cell + 8);
      const img = images[i];
      const s = Math.min(cell / img.width, cell / img.height);
      page.drawImage(img, { x: M + col * (cell + 8), y: y - img.height * s, width: img.width * s, height: img.height * s });
      if (col === 3 || i === images.length - 1) y -= cell + 8;
    }
    if (images.length < ins.photos.length) para('Certaines photos ne sont pas reproduites ici (format non imprimable ou au-delà de 12).', M, 8, font, GREY);
  }

  // ---------- Signature ----------
  heading('Signature du client');
  if (ins.client_signed_at) {
    const sig = ins.client_signature_url ? await embed(pdf, await download(supabase, ins.client_signature_url)) : null;
    if (sig) {
      const s = Math.min(200 / sig.width, 70 / sig.height);
      ensure(sig.height * s + 30);
      page.drawImage(sig, { x: M, y: y - sig.height * s, width: sig.width * s, height: sig.height * s });
      y -= sig.height * s + 8;
    }
    para(`${ins.client_signer_name ?? ''}, le ${fmt(ins.client_signed_at)}`, M, 9, bold);
    para(
      kind === 'reception'
        ? "Le client reconnaît l'exactitude de l'état du véhicule décrit ci-dessus à la remise des clés."
        : "Le client reconnaît avoir récupéré son véhicule dans l'état décrit ci-dessus.",
      M,
      8,
      font,
      GREY
    );
  } else {
    para('Fiche non signée par le client (brouillon).', M, 9, bold, RED);
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const s = sanitizeForPdf(`${INSPECTION_KIND_LABELS[kind]} - ${order.order_number ?? ''} - page ${i + 1}/${pages.length}`);
    p.drawText(s, { x: M, y: M - 8, size: 7, font, color: GREY });
  });

  const bytes = await pdf.save();
  const safe = String(order.order_number ?? 'OR').replace(/[^A-Za-z0-9-]/g, '');
  return { buffer: Buffer.from(bytes), filename: `${kind === 'reception' ? 'Reception' : 'Restitution'}-${safe}.pdf` };
}
