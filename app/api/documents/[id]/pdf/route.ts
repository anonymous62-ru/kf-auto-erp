import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderDocumentPdf } from '@/lib/documents/pdf/render-document-pdf';
import { canDownloadDocument, sendBlockedReason } from '@/lib/documents/workflow-rules';
import { getMyPermissions } from '@/lib/permissions';

// PDF consulté par un employé connecté : la RLS décide s'il y a accès.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Circuit de vente (0044) : pas de PDF avant validation (sauf valideurs).
    const { data: auth } = await supabase.auth.getUser();
    const [{ data: wf }, { data: me }, perms] = await Promise.all([
      supabase.from('documents').select('document_type, workflow_status').eq('id', id).maybeSingle(),
      supabase.from('profiles').select('role').eq('id', auth.user?.id ?? '').maybeSingle(),
      getMyPermissions(),
    ]);
    if (wf && !canDownloadDocument(wf.document_type, wf.workflow_status, me?.role, perms)) {
      return NextResponse.json({ error: sendBlockedReason(wf.document_type, wf.workflow_status) }, { status: 403 });
    }

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
