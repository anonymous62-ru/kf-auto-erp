import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderDocumentPdf } from '@/lib/documents/pdf/render-document-pdf';
import { canSendDocument } from '@/lib/documents/workflow-rules';

// Lien envoyé au client final (WhatsApp / Email), qui n'a pas de compte :
// accès uniquement par le jeton aléatoire propre au document
// (documents.public_token, migration 0029), jamais par son identifiant.
// Seul ce PDF est renvoyé, aucune autre donnée.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (!UUID_RE.test(token)) {
      return NextResponse.json({ error: 'Lien invalide' }, { status: 404 });
    }
    const admin = createAdminClient();
    // Circuit de vente (0044) : le lien client ne fonctionne qu'après validation.
    const { data: wf } = await admin
      .from('documents')
      .select('document_type, workflow_status')
      .eq('public_token', token)
      .maybeSingle();
    if (wf && !canSendDocument(wf.document_type, wf.workflow_status)) {
      return NextResponse.json({ error: 'Document pas encore disponible' }, { status: 404 });
    }
    const result = await renderDocumentPdf(admin, { column: 'public_token', value: token }, req.nextUrl.origin);
    if (!result) return NextResponse.json({ error: 'Document introuvable ou lien expiré' }, { status: 404 });

    return new NextResponse(result.buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${result.filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch (e) {
    console.error('[pdf-public] génération échouée :', e);
    return NextResponse.json({ error: 'Échec de la génération du PDF' }, { status: 500 });
  }
}
