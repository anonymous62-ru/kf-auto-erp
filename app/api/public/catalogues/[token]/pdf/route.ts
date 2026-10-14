import { NextRequest, NextResponse } from 'next/server';
import { findSendingByToken, recordCatalogueOpen, renderPublicCataloguePdf } from '@/lib/catalogue/public';

// PDF du catalogue envoyé à un client : accès par jeton, sans compte,
// refusé après expiration du lien (30 jours).
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const { sending, expired } = await findSendingByToken(token);
    if (!sending) return NextResponse.json({ error: 'Catalogue introuvable' }, { status: 404 });
    if (expired) return NextResponse.json({ error: 'Ce lien a expiré. Demandez un nouveau catalogue à votre conseiller.' }, { status: 410 });

    const rendered = await renderPublicCataloguePdf(sending);
    if (!rendered) return NextResponse.json({ error: 'Catalogue indisponible' }, { status: 404 });

    // Ouverture directe du PDF (sans passer par la page) : comptée aussi.
    if (req.nextUrl.searchParams.get('from') !== 'page') {
      await recordCatalogueOpen(sending, req.headers.get('user-agent'));
    }

    return new NextResponse(new Uint8Array(rendered.buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${encodeURIComponent(rendered.filename)}"`,
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch (e) {
    console.error('[catalogue-public] génération échouée :', e);
    return NextResponse.json({ error: 'Échec de la génération du catalogue' }, { status: 500 });
  }
}
