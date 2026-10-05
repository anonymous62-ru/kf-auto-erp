import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildContractPdf } from '@/lib/contracts/pdf/build-contract-pdf';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data: contract, error } = await supabase
      .from('sale_contracts')
      .select(
        `id, contract_number, sale_price, payment_terms, notes, created_at, organization_id, commercial_id,
         commercial_signature_url, client_signature_url,
         clients (first_name, last_name, company_name, phone, address, email),
         products (designation, brand, model, reference, sku)`
      )
      .eq('id', id)
      .single();

    if (error || !contract) {
      return NextResponse.json({ error: 'Contrat introuvable', details: error?.message }, { status: 404 });
    }

    const { data: organization } = await supabase
      .from('organizations')
      .select('name, logo_url, address, phones, rccm, nif, terms_and_conditions')
      .eq('id', contract.organization_id)
      .single();

    const { data: commercial } = await supabase
      .from('profiles')
      .select('full_name, phone')
      .eq('id', contract.commercial_id)
      .single();

    const client = Array.isArray(contract.clients) ? contract.clients[0] : contract.clients;
    const product = Array.isArray(contract.products) ? contract.products[0] : contract.products;

    const buffer = await buildContractPdf({
      contract,
      organization: organization ?? { name: 'KF Auto SARL' },
      client: client ?? {},
      product: product ?? { designation: '' },
      commercial: commercial ?? { full_name: '' },
    });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="contrat-${contract.contract_number ?? contract.id}.pdf"`,
      },
    });
  } catch (e) {
    console.error('[contract-pdf] génération échouée :', e);
    // Détail gardé dans les logs Vercel (ligne ci-dessus), jamais renvoyé au navigateur.
    return NextResponse.json({ error: 'Échec de la génération du contrat' }, { status: 500 });
  }
}
