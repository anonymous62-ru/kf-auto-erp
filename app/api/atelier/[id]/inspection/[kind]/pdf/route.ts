import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderInspectionPdf } from '@/lib/atelier/inspection-pdf';
import { isInspectionKind } from '@/lib/atelier/inspection-config';

// PDF d'une fiche de réception / restitution, consulté par un employé
// connecté : la RLS (table et bucket privé) décide de l'accès.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; kind: string }> }) {
  try {
    const { id, kind } = await params;
    if (!isInspectionKind(kind)) return NextResponse.json({ error: 'Type de fiche inconnu' }, { status: 404 });
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const result = await renderInspectionPdf(supabase, id, kind);
    if (!result) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 });

    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${result.filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    console.error('[pdf fiche SAV] génération échouée :', e);
    return NextResponse.json({ error: 'Échec de la génération du PDF' }, { status: 500 });
  }
}
