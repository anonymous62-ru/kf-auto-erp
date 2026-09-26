'use server';

import { createClient } from '@/lib/supabase/server';
import { computeDocumentTotals, type DocumentItemInput } from '@/lib/documents/calculations';
import { redirect } from 'next/navigation';

export type DocumentType = 'proforma' | 'devis' | 'facture' | 'bon_livraison' | 'recu' | 'avoir';

// ---------- Recherche clients ----------
export async function searchClients(query: string) {
  const supabase = await createClient();
  let request = supabase
    .from('clients')
    .select('id, first_name, last_name, company_name, phone')
    .order('created_at', { ascending: false })
    .limit(15);

  if (query.trim()) {
    request = request.or(
      `first_name.ilike.%${query}%,last_name.ilike.%${query}%,company_name.ilike.%${query}%,phone.ilike.%${query}%`
    );
  }

  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ---------- Creation rapide d'un client (chemin d'or : pas besoin de quitter le devis) ----------
export async function createQuickClient(input: {
  firstName?: string;
  lastName?: string;
  companyName?: string;
  phone?: string;
}) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifie');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError) throw new Error(`Erreur profil : ${profileError.message}`);
  if (!profile) throw new Error(`Aucun profil trouve pour l'utilisateur ${userData.user.id}`);

  const { data, error } = await supabase
    .from('clients')
    .insert({
      organization_id: profile.organization_id,
      assigned_to: userData.user.id,
      created_by: userData.user.id,
      first_name: input.firstName,
      last_name: input.lastName,
      company_name: input.companyName,
      phone: input.phone,
    })
    .select('id, first_name, last_name, company_name, phone')
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// ---------- Recherche produits ----------
export async function searchProducts(query: string) {
  const supabase = await createClient();
  let request = supabase
    .from('products')
    .select('id, designation, sku, sale_price, tax_rate')
    .eq('is_active', true)
    .order('designation')
    .limit(15);

  if (query.trim()) {
    request = request.ilike('designation', `%${query}%`);
  }

  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ---------- Creation d'un document (devis/proforma/facture/...) ----------
export interface CreateDocumentInput {
  documentType: DocumentType;
  clientId: string;
  items: Array<DocumentItemInput & { designation: string; productId?: string }>;
  notes?: string;
}

export async function createDocument(input: CreateDocumentInput) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifie');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError) throw new Error(`Erreur profil : ${profileError.message}`);
  if (!profile) throw new Error(`Aucun profil trouve pour l'utilisateur ${userData.user.id}`);

  if (input.items.length === 0) throw new Error('Ajoutez au moins un article');

  const totals = computeDocumentTotals(input.items);
  const year = new Date().getFullYear();

  // Attribution atomique du numero officiel (Phase 2 : fonction PostgreSQL)
  const { data: documentNumber, error: numberError } = await supabase.rpc(
    'get_next_document_number',
    {
      p_organization_id: profile.organization_id,
      p_document_type: input.documentType,
      p_year: year,
    }
  );
  if (numberError) throw new Error(numberError.message);

  const { data: document, error: documentError } = await supabase
    .from('documents')
    .insert({
      organization_id: profile.organization_id,
      document_type: input.documentType,
      document_number: documentNumber,
      status: 'brouillon',
      client_id: input.clientId,
      commercial_id: userData.user.id,
      issue_date: new Date().toISOString().slice(0, 10),
      subtotal: totals.subtotal,
      tax_amount: totals.taxAmount,
      total_amount: totals.totalAmount,
      notes: input.notes,
    })
    .select('id, document_number')
    .single();

  if (documentError) throw new Error(documentError.message);

  const itemRows = input.items.map((item, index) => ({
    document_id: document.id,
    product_id: item.productId ?? null,
    designation: item.designation,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    tax_rate: item.taxRate,
    discount_percent: item.discountPercent ?? 0,
    position: index,
  }));

  const { error: itemsError } = await supabase.from('document_items').insert(itemRows);
  if (itemsError) throw new Error(itemsError.message);

  redirect(`/documents/${document.id}`);
}

// ---------- Conversion devis/proforma -> facture ----------
// Parcours frequent : le client accepte un devis, on le transforme en facture
// sans ressaisir les lignes. Le document source est marque "accepte" et reste
// consultable ; la nouvelle facture recoit son propre numero officiel et est
// liee via parent_document_id.
export async function convertToFacture(sourceDocumentId: string) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifie');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError) throw new Error(`Erreur profil : ${profileError.message}`);
  if (!profile) throw new Error('Profil introuvable');

  const { data: source, error: sourceError } = await supabase
    .from('documents')
    .select('id, document_type, client_id, commercial_id, subtotal, tax_amount, total_amount, notes')
    .eq('id', sourceDocumentId)
    .maybeSingle();
  if (sourceError) throw new Error(sourceError.message);
  if (!source) throw new Error('Document source introuvable');
  if (!['devis', 'proforma'].includes(source.document_type)) {
    throw new Error('Seul un devis ou une proforma peut être converti en facture.');
  }

  const { data: sourceItems, error: itemsFetchError } = await supabase
    .from('document_items')
    .select('product_id, designation, quantity, unit_price, tax_rate, discount_percent, position')
    .eq('document_id', sourceDocumentId)
    .order('position');
  if (itemsFetchError) throw new Error(itemsFetchError.message);
  if (!sourceItems || sourceItems.length === 0) throw new Error('Ce document ne contient aucun article.');

  const year = new Date().getFullYear();
  const { data: documentNumber, error: numberError } = await supabase.rpc('get_next_document_number', {
    p_organization_id: profile.organization_id,
    p_document_type: 'facture',
    p_year: year,
  });
  if (numberError) throw new Error(numberError.message);

  const { data: facture, error: factureError } = await supabase
    .from('documents')
    .insert({
      organization_id: profile.organization_id,
      document_type: 'facture',
      document_number: documentNumber,
      status: 'brouillon',
      client_id: source.client_id,
      commercial_id: source.commercial_id,
      parent_document_id: source.id,
      issue_date: new Date().toISOString().slice(0, 10),
      subtotal: source.subtotal,
      tax_amount: source.tax_amount,
      total_amount: source.total_amount,
      notes: source.notes,
    })
    .select('id')
    .single();
  if (factureError) throw new Error(factureError.message);

  const itemRows = sourceItems.map((item) => ({
    document_id: facture.id,
    product_id: item.product_id,
    designation: item.designation,
    quantity: item.quantity,
    unit_price: item.unit_price,
    tax_rate: item.tax_rate,
    discount_percent: item.discount_percent,
    position: item.position,
  }));
  const { error: newItemsError } = await supabase.from('document_items').insert(itemRows);
  if (newItemsError) throw new Error(newItemsError.message);

  // le devis/proforma d'origine est marque "accepte" (n'a plus de sens de le renvoyer tel quel)
  await supabase.from('documents').update({ status: 'accepte' }).eq('id', source.id);

  redirect(`/documents/${facture.id}`);
}

// ---------- Historique d'envoi ----------
export async function recordSending(input: {
  documentId: string;
  channel: 'email' | 'whatsapp' | 'sms';
  recipient: string;
}) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifie');

  const { error } = await supabase.from('document_sendings').insert({
    document_id: input.documentId,
    channel: input.channel,
    recipient: input.recipient,
    status: 'envoye',
    sent_at: new Date().toISOString(),
    sent_by: userData.user.id,
  });
  if (error) throw new Error(error.message);

  await supabase.from('documents').update({ status: 'envoye' }).eq('id', input.documentId);
}

export async function getSendingHistory(documentId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('document_sendings')
    .select('id, channel, recipient, status, sent_at')
    .eq('document_id', documentId)
    .order('sent_at', { ascending: false });
  return data ?? [];
}
