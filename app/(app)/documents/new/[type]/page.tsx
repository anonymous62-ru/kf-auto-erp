import { notFound } from 'next/navigation';
import { DocumentForm } from '@/components/documents/document-form';
import { createClient } from '@/lib/supabase/server';
import type { DocumentType } from '@/lib/documents/actions';

const VALID_TYPES: DocumentType[] = ['proforma', 'devis', 'facture', 'bon_livraison', 'recu', 'avoir'];

export default async function NewDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<{ clientId?: string }>;
}) {
  const { type } = await params;
  const { clientId } = await searchParams;
  if (!VALID_TYPES.includes(type as DocumentType)) {
    notFound();
  }

  let initialClient = null;
  if (clientId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from('clients')
      .select('id, first_name, last_name, company_name, phone')
      .eq('id', clientId)
      .maybeSingle();
    initialClient = data;
  }

  return <DocumentForm documentType={type as DocumentType} initialClient={initialClient} />;
}
