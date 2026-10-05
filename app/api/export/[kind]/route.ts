import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { STATUS_LABELS, type ProspectStatus } from '@/lib/import/contacts';

// Export Excel (CSV) de la liste des clients ou des prospects.
// Réservé à la direction : un export complet permettrait à n'importe qui
// de repartir avec tout le fichier clients de l'entreprise. Chaque export
// est noté dans le journal d'audit (fonction log_export, migration 0021).
const EXPORT_ROLES = ['super_admin', 'administrateur', 'manager'];

const SOURCE_LABELS: Record<string, string> = {
  showroom: 'Showroom',
  appel: 'Appel',
  whatsapp: 'WhatsApp',
  site_web: 'Site web',
  reseaux_sociaux: 'Réseaux sociaux',
  recommandation: 'Recommandation',
  autre: 'Autre',
};

function csvCell(value: unknown) {
  let s = value === null || value === undefined ? '' : String(value);
  // Anti-injection de formule : une cellule qui commence par = + - @ serait
  // exécutée comme formule par Excel (ex. note importée "=HYPERLINK(...)").
  if (/^[=+\-@\t\r]/.test(s) && !/^\+[\d\s]+$/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function frDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString('fr-FR', { timeZone: 'Africa/Lome' }) : '';
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const { kind } = await params;
    if (kind !== 'clients' && kind !== 'prospects') {
      return NextResponse.json({ error: 'Export inconnu' }, { status: 404 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (!profile || !EXPORT_ROLES.includes(profile.role)) {
      return NextResponse.json({ error: "Export réservé à la direction (administrateur, manager)." }, { status: 403 });
    }

    const columns: string =
      kind === 'clients'
        ? 'client_type, company_name, last_name, first_name, main_contact_name, phone, whatsapp, email, address, city, assigned_to, created_at, notes'
        : 'company_name, last_name, first_name, contact_name, phone, whatsapp, email, sector, source, status, next_relance_at, assigned_to, created_at, notes';

    // Lecture par pages de 1000 (limite par requête de Supabase).
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from(kind)
        .select(columns)
        .order('created_at', { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
      if (!data || data.length < 1000) break;
    }

    const { data: people } = await supabase.from('profiles').select('id, full_name');
    const names = new Map((people ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name ?? '']));

    const header =
      kind === 'clients'
        ? ['Type', 'Entreprise', 'Nom', 'Prénoms', 'Contact', 'Téléphone', 'WhatsApp', 'Email', 'Adresse', 'Ville', 'Commercial', 'Créé le', 'Notes']
        : ['Entreprise', 'Nom', 'Prénoms', 'Contact', 'Téléphone', 'WhatsApp', 'Email', 'Secteur', 'Origine', 'Statut', 'Prochaine relance', 'Commercial', 'Créé le', 'Notes'];

    const lines = rows.map((r) => {
      const commercial = names.get(String(r.assigned_to ?? '')) ?? '';
      const values =
        kind === 'clients'
          ? [
              r.client_type === 'entreprise' ? 'Entreprise' : 'Particulier',
              r.company_name, r.last_name, r.first_name, r.main_contact_name, r.phone, r.whatsapp, r.email,
              r.address, r.city, commercial, frDate(r.created_at as string), r.notes,
            ]
          : [
              r.company_name, r.last_name, r.first_name, r.contact_name, r.phone, r.whatsapp, r.email, r.sector,
              SOURCE_LABELS[String(r.source)] ?? r.source, STATUS_LABELS[r.status as ProspectStatus] ?? r.status,
              frDate(r.next_relance_at as string | null), commercial, frDate(r.created_at as string), r.notes,
            ];
      return values.map(csvCell).join(';');
    });

    await supabase.rpc('log_export', { p_table: kind, p_count: rows.length });

    // BOM UTF-8 + séparateur point-virgule : s'ouvre directement dans Excel
    // en français, accents compris.
    const csv = `﻿${[header.join(';'), ...lines].join('\r\n')}\r\n`;
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="kf-auto-${kind}-${date}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Export impossible' }, { status: 500 });
  }
}
