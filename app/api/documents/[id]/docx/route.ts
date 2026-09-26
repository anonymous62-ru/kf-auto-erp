import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildDocumentDocx } from '@/lib/documents/docx/build-docx';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data: document, error } = await supabase
      .from('documents')
      .select(
        `id, document_type, document_number, issue_date, due_date, subtotal, tax_amount, total_amount, status,
         commercial_signature_url, client_signature_url, organization_id, commercial_id,
         clients (first_name, last_name, company_name, phone, address, email)`
      )
      .eq('id', id)
      .single();

    if (error || !document) {
      return NextResponse.json({ error: 'Document introuvable', details: error?.message }, { status: 404 });
    }

    const { data: organization } = await supabase
      .from('organizations')
      .select('name, logo_url, bank_name, bank_account, rccm, nif, cnss_number, address, phones, terms_and_conditions')
      .eq('id', document.organization_id)
      .single();

    const { data: commercial } = await supabase
      .from('profiles')
      .select('full_name, phone')
      .eq('id', document.commercial_id)
      .single();

    const { data: items } = await supabase
      .from('document_items')
      .select('designation, quantity, unit_price, line_total')
      .eq('document_id', id)
      .order('position');

    const client = Array.isArray(document.clients) ? document.clients[0] : document.clients;

    const documentForDocx = {
      document_type: document.document_type,
      document_number: document.document_number,
      issue_date: document.issue_date,
      due_date: document.due_date,
      subtotal: Number(document.subtotal || 0),
      tax_amount: Number(document.tax_amount || 0),
      total_amount: Number(document.total_amount || 0),
      status: document.status ?? null,
      commercial_signature_url: document.commercial_signature_url ?? null,
      client_signature_url: document.client_signature_url ?? null,
    };

    const buffer = await buildDocumentDocx({
      document: documentForDocx,
      organization: organization ?? { name: 'KF Auto SARL' },
      client: client ?? {},
      commercial: commercial ?? { full_name: '' },
      items: items ?? [],
    });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${document.document_number ?? document.id}.docx"`,
      },
    });
  } catch (e) {
    console.error('[docx] génération échouée :', e);
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Échec de la génération du DOCX', details: message }, { status: 500 });
  }
}
