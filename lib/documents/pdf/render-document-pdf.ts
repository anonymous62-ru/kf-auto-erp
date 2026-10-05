// Génération du PDF d'un document, partagée entre la route privée (employé
// connecté, accès contrôlé par la RLS) et la route publique (client final,
// accès par jeton, via la clé service_role).
import QRCode from 'qrcode';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildDocumentPdf } from '@/lib/documents/pdf/build-pdf';

export async function renderDocumentPdf(
  supabase: SupabaseClient,
  lookup: { column: 'id' | 'public_token'; value: string },
  origin: string
): Promise<{ buffer: Buffer; filename: string } | null> {
  const { data: document, error } = await supabase
    .from('documents')
    .select(
      `id, document_type, document_number, issue_date, due_date, subtotal, tax_amount, total_amount, status,
       commercial_signature_url, client_signature_url, organization_id, commercial_id,
       clients (first_name, last_name, company_name, phone, address, email)`
    )
    .eq(lookup.column, lookup.value)
    .maybeSingle();

  if (error || !document) return null;

  const { data: organization } = await supabase
    .from('organizations')
    .select('name, logo_url, bank_name, bank_account, rccm, nif, cnss_number, address, phones, terms_and_conditions')
    .eq('id', document.organization_id)
    .single();

  const { data: commercial } = await supabase
    .from('profiles')
    .select('full_name, phone')
    .eq('id', document.commercial_id)
    .maybeSingle();

  const { data: items } = await supabase
    .from('document_items')
    .select('designation, quantity, unit_price, line_total')
    .eq('document_id', document.id)
    .order('position');

  const client = Array.isArray(document.clients) ? document.clients[0] : document.clients;

  const verifyUrl = `${origin}/verify/${document.id}`;
  const qrCodeDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 0 });

  const buffer = await buildDocumentPdf({
    document: {
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
    },
    organization: organization ?? { name: 'KF Auto SARL' },
    client: client ?? {},
    commercial: commercial ?? { full_name: '' },
    items: items ?? [],
    qrCodeDataUrl,
  });

  return { buffer, filename: `${document.document_number ?? document.id}.pdf` };
}
