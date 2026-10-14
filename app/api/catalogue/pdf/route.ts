import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildCataloguePdf } from '@/lib/catalogue/pdf/build-catalogue-pdf';
import { loadCatalogueModels, loadCatalogueOrganization, loadCatalogueSender } from '@/lib/catalogue/data';
import { CATALOGUE_SENDER_ROLES } from '@/lib/catalogue/roles';

// Aperçu interne d'un catalogue avant envoi (employé connecté, RLS).
// ?models=id1,id2&prices=1&until=AAAA-MM-JJ&name=Destinataire
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const { data: profile } = await supabase.from('profiles').select('role, organization_id').eq('id', user.id).maybeSingle();
    if (!profile || !CATALOGUE_SENDER_ROLES.includes(profile.role as string)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const sp = req.nextUrl.searchParams;
    const ids = (sp.get('models') ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter((x) => /^[0-9a-f-]{36}$/i.test(x))
      .slice(0, 20);
    if (ids.length === 0) return NextResponse.json({ error: 'Choisissez au moins un modèle' }, { status: 400 });
    const until = sp.get('until');
    const showPrices = sp.get('prices') === '1' && !!until && /^\d{4}-\d{2}-\d{2}$/.test(until);

    const orgId = profile.organization_id as string;
    const [models, organization, sender] = await Promise.all([
      loadCatalogueModels(supabase, orgId, ids),
      loadCatalogueOrganization(supabase, orgId),
      loadCatalogueSender(supabase, user.id),
    ]);
    if (models.length === 0) return NextResponse.json({ error: 'Modèles introuvables' }, { status: 404 });

    const buffer = await buildCataloguePdf({
      models,
      organization,
      sender,
      options: {
        kind: models.length === 1 ? 'fiche' : 'gamme',
        showPrices,
        pricesValidUntil: showPrices ? until : null,
        recipientName: (sp.get('name') ?? '').slice(0, 80) || null,
        date: new Date(),
      },
    });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="apercu-catalogue.pdf"',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    console.error('[catalogue] aperçu échoué :', e);
    return NextResponse.json({ error: "Échec de la génération de l'aperçu" }, { status: 500 });
  }
}
