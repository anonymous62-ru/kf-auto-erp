import { notFound, redirect } from 'next/navigation';
import { getCurrentRole } from '@/lib/permissions';
import { INVOICE_EDITOR_ROLES } from '@/lib/documents/invoice-rules';
import { DocumentForm } from '@/components/documents/document-form';
import { createClient } from '@/lib/supabase/server';
import type { DocumentType } from '@/lib/documents/actions';

// Création directe : la facture proforma (type interne "devis") pour tout le
// monde ; la commande naît d'une proforma (bouton "Passer en commande") ; la
// facture est réservée à l'administration des ventes et à la direction
// (règle du 09/10). L'ancien type "proforma" n'est plus proposé. Un avoir
// ne se crée jamais seul : il part de la facture qu'il corrige (bouton
// « Créer un avoir », règle du 10/10).
const VALID_TYPES: DocumentType[] = ['devis', 'facture', 'bon_livraison', 'recu'];
const BILLING_ONLY: DocumentType[] = ['facture'];

export default async function NewDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<{ clientId?: string }>;
}) {
  const { type: rawType } = await params;
  const { clientId } = await searchParams;
  // Anciens liens (/documents/new/proforma) : on ouvre une facture proforma.
  const type = rawType === 'proforma' ? 'devis' : rawType;
  if (!VALID_TYPES.includes(type as DocumentType)) {
    notFound();
  }
  if (BILLING_ONLY.includes(type as DocumentType)) {
    const role = await getCurrentRole();
    if (!INVOICE_EDITOR_ROLES.includes(role ?? '')) {
      redirect('/documents/new/devis' + (clientId ? `?clientId=${clientId}` : ''));
    }
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
