import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildVehicleSheetPdf } from '@/lib/products/pdf/build-vehicle-sheet-pdf';

// Client admin (service_role) volontairement, et non le client "cookies"
// habituel : cette fiche est destinée à être ouverte par le CLIENT final via
// un lien WhatsApp, qui n'a pas de session dans l'application. Avec le
// client normal, la RLS bloquerait la lecture pour un visiteur non connecté
// et le lien partagé ne s'ouvrirait jamais côté client.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();

    const { data: product, error } = await admin
      .from('products')
      .select('id, organization_id, designation, brand, model, reference, sku, description, sale_price')
      .eq('id', id)
      .single();

    if (error || !product) {
      return NextResponse.json({ error: 'Véhicule introuvable', details: error?.message }, { status: 404 });
    }

    const { data: organization } = await admin
      .from('organizations')
      .select('name, logo_url, phones, address')
      .eq('id', product.organization_id)
      .single();

    const { data: photos } = await admin
      .from('product_photos')
      .select('url')
      .eq('product_id', id)
      .order('position', { ascending: true });

    const buffer = await buildVehicleSheetPdf({
      product,
      organization: organization ?? { name: 'KF Auto SARL' },
      photoUrls: (photos ?? []).map((p) => p.url),
    });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="vehicule-${product.designation}.pdf"`,
      },
    });
  } catch (e) {
    console.error('[vehicle-pdf] génération échouée :', e);
    const message = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    return NextResponse.json({ error: 'Échec de la génération de la fiche', details: message, stack }, { status: 500 });
  }
}
