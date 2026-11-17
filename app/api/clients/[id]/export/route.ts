import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createClient } from '@/lib/supabase/server';
import { buildZip } from '@/lib/clients/zip';
import { clientDocumentLabel, missingClientDocuments, safeFileName } from '@/lib/clients/required-documents';

// Export du dossier client : ZIP de toutes les pièces justificatives et
// d'un récapitulatif PDF de la fiche. Tout passe par la session de
// l'utilisateur (RLS clients, client_documents et storage.objects) : qui ne
// peut pas lire le client n'obtient rien. Chaque export est journalisé
// (fonction log_client_export, migration 0046).
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

// Polices standard du PDF : jeu WinAnsi uniquement.
function pdfText(s: string) {
  return Array.from(s)
    .map((ch) => (ch.charCodeAt(0) <= 0xff || 'œŒ€’‘“”…'.includes(ch) ? ch : '?'))
    .join('')
    .replace(/[\r\n\t]+/g, ' ');
}

async function recapPdf(lines: [string, string][], missing: string[], files: string[], title: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]);
  let y = 790;
  const write = (text: string, opts: { size?: number; f?: typeof font; color?: [number, number, number] } = {}) => {
    if (y < 60) {
      page = pdf.addPage([595, 842]);
      y = 790;
    }
    const size = opts.size ?? 10;
    const f = opts.f ?? font;
    let t = pdfText(text);
    while (t.length > 1 && f.widthOfTextAtSize(t, size) > 495) t = t.slice(0, -2) + '.';
    page.drawText(t, { x: 50, y, size, font: f, color: rgb(...(opts.color ?? [0.12, 0.16, 0.22])) });
    y -= size + 6;
  };

  write('KF Auto - Dossier client', { size: 9, color: [0.4, 0.4, 0.4] });
  write(title, { size: 16, f: bold });
  y -= 6;
  for (const [label, value] of lines) write(`${label} : ${value || '-'}`);
  y -= 8;
  write('Pièces justificatives', { size: 12, f: bold });
  if (files.length === 0) write('Aucune pièce fournie.');
  for (const f of files) write(`- ${f}`);
  y -= 8;
  if (missing.length) {
    write(`Pièce manquante : ${missing.join(', ')}`, { color: [0.65, 0.38, 0.04] });
    write('Une pièce manquante ne bloque pas la vente.', { size: 9, color: [0.4, 0.4, 0.4] });
  } else write('Dossier complet.', { color: [0.07, 0.5, 0.31] });
  y -= 8;
  write(`Exporté le ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Lome' })}`, { size: 8, color: [0.5, 0.5, 0.5] });
  return pdf.save();
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Client inconnu' }, { status: 404 });

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { data: client } = await supabase
      .from('clients')
      .select('id, client_type, first_name, last_name, company_name, phone, email, address, city, bank_name, client_number, rccm, nif, status')
      .eq('id', id)
      .maybeSingle();
    if (!client) return NextResponse.json({ error: 'Client introuvable ou accès refusé' }, { status: 404 });

    const { data: docs, error: docsError } = await supabase
      .from('client_documents')
      .select('id, kind, file_name, mime_type, storage_path, created_at')
      .eq('client_id', id)
      .order('kind')
      .order('created_at');
    if (docsError) return NextResponse.json({ error: docsError.message }, { status: 500 });

    const used = new Set<string>();
    const entries: { name: string; data: Uint8Array }[] = [];
    const listed: string[] = [];
    for (const d of docs ?? []) {
      const { data: blob, error } = await supabase.storage.from('client-documents').download(d.storage_path);
      if (error || !blob) {
        listed.push(`${clientDocumentLabel(d.kind)} : ${d.file_name} (fichier illisible)`);
        continue;
      }
      const base = safeFileName(d.file_name).replace(/\.[A-Za-z0-9]+$/, '') || 'piece';
      const ext = MIME_EXT[d.mime_type] ?? 'bin';
      let name = `${d.kind}-${base}.${ext}`;
      for (let i = 2; used.has(name); i++) name = `${d.kind}-${base}-${i}.${ext}`;
      used.add(name);
      entries.push({ name: `pieces/${name}`, data: new Uint8Array(await blob.arrayBuffer()) });
      listed.push(`${clientDocumentLabel(d.kind)} : ${d.file_name}`);
    }

    const clientName = client.company_name || `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim() || 'Client';
    const missing = missingClientDocuments(client.client_type, (docs ?? []).map((d) => d.kind as string)).map((m) => m.label);
    const lines: [string, string][] = [
      ['Type', client.client_type === 'entreprise' ? 'Entreprise' : 'Particulier'],
      ['N° client', client.client_number ?? ''],
      ['Nom', clientName],
      ['Téléphone', client.phone ?? ''],
      ['E-mail', client.email ?? ''],
      ['Adresse', [client.address, client.city].filter(Boolean).join(', ')],
      ['Banque du client', client.bank_name ?? 'non renseignée'],
    ];
    if (client.client_type === 'entreprise') lines.push(['RCCM', client.rccm ?? ''], ['NIF', client.nif ?? '']);
    entries.unshift({ name: 'recapitulatif.pdf', data: await recapPdf(lines, missing, listed, clientName) });

    await supabase.rpc('log_client_export', { p_client: id, p_count: entries.length - 1 });

    const zip = buildZip(entries);
    const fileBase = safeFileName(`dossier-${client.client_number || clientName}`);
    return new NextResponse(Buffer.from(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileBase}.zip"`,
        'Content-Length': String(zip.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Export impossible' }, { status: 500 });
  }
}
