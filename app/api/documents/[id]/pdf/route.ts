import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderDocumentPdf } from '@/lib/documents/pdf/render-document-pdf';

// PDF consulté par un employé connecté : la RLS décide s'il y a accès.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const result = await renderDocumentPdf(supabase, { column: 'id', value: id }, req.nextUrl.origin);
    if (!result) return NextResponse.json({ error: 'Document introuvable' }, { status: 404 });

    return new NextResponse(result.buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${result.filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    console.error('[pdf] génération échouée :', e);
    return NextResponse.json({ error: 'Échec de la génération du PDF' }, { status: 500 });
  }
}
