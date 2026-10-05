'use server';

import { createClient } from '@/lib/supabase/server';
import { computeDocumentTotals, type DocumentItemInput } from '@/lib/documents/calculations';
import { applyFactureStockDeduction } from '@/lib/documents/stock-deduction';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { applyClientSearch } from '@/lib/search';

export type DocumentType = 'proforma' | 'devis' | 'facture' | 'bon_livraison' | 'recu' | 'avoir';

// ---------- Recherche clients ----------
export async function searchClients(query: string) {
  const supabase = await createClient();
  let request = supabase
    .from('clients')
    .select('id, first_name, last_name, company_name, phone')
    .order('created_at', { ascending: false })
    .limit(15);

  request = applyClientSearch(request, query);

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
  const issueDate = new Date();
  const dueDate = new Date(issueDate);
  dueDate.setMonth(dueDate.getMonth() + 1);

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
      issue_date: issueDate.toISOString().slice(0, 10),
      // Échéance par défaut : un mois après l'émission, avant paiement.
      // Modifiable ensuite si besoin (aucun champ d'édition dédié pour
      // l'instant : à ajouter si un délai différent devient courant).
      due_date: dueDate.toISOString().slice(0, 10),
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

  // Règle du DG (04/10) : une facture retire automatiquement du stock ce
  // qu'elle contient — un devis, lui, ne touche jamais au stock.
  if (input.documentType === 'facture') {
    await applyFactureStockDeduction(supabase, {
      organizationId: profile.organization_id,
      documentId: document.id,
      documentNumber: document.document_number,
      items: input.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      performedBy: userData.user.id,
    });
  }

  redirect(`/documents/${document.id}`);
}

// ---------- Conversion devis/proforma -> facture ----------
// Parcours frequent : le client accepte un devis, on le transforme en facture
// sans ressaisir les lignes. Le document source est marque "accepte" et reste
// consultable ; la nouvelle facture recoit son propre numero officiel et est
// liee via parent_document_id.
// Renvoie { error } en cas de refus (message lisible en production, où
// Next.js masque les erreurs levées) ; redirige vers la facture en cas de
// succès, ou vers la facture déjà existante si le devis a déjà été converti.
export async function convertToFacture(sourceDocumentId: string): Promise<{ error: string } | undefined> {
  let target: string;
  try {
    target = await convertToFactureInner(sourceDocumentId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/row-level security/i.test(message)) {
      return { error: "Vous n'avez pas le droit de convertir ce document." };
    }
    return { error: message || 'La conversion a échoué.' };
  }
  redirect(`/documents/${target}`);
}

async function convertToFactureInner(sourceDocumentId: string): Promise<string> {
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

  // Garde anti double-clic / double conversion : si une facture existe déjà
  // pour ce devis, on l'ouvre au lieu d'en créer une seconde (qui aurait
  // consommé un numéro et retiré le stock deux fois).
  const { data: existingInvoice } = await supabase
    .from('documents')
    .select('id')
    .eq('parent_document_id', sourceDocumentId)
    .eq('document_type', 'facture')
    .limit(1)
    .maybeSingle();
  if (existingInvoice) return existingInvoice.id;

  const { data: sourceItems, error: itemsFetchError } = await supabase
    .from('document_items')
    .select('product_id, designation, quantity, unit_price, tax_rate, discount_percent, position')
    .eq('document_id', sourceDocumentId)
    .order('position');
  if (itemsFetchError) throw new Error(itemsFetchError.message);
  if (!sourceItems || sourceItems.length === 0) throw new Error('Ce document ne contient aucun article.');

  const year = new Date().getFullYear();
  const issueDate = new Date();
  const dueDate = new Date(issueDate);
  dueDate.setMonth(dueDate.getMonth() + 1);
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
      issue_date: issueDate.toISOString().slice(0, 10),
      due_date: dueDate.toISOString().slice(0, 10),
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

  // Règle du DG (04/10) : la conversion en facture retire du stock ce que
  // le devis d'origine contenait (le devis lui-même n'y avait jamais touché).
  await applyFactureStockDeduction(supabase, {
    organizationId: profile.organization_id,
    documentId: facture.id,
    documentNumber: documentNumber,
    items: sourceItems.map((i) => ({ productId: i.product_id, quantity: i.quantity })),
    performedBy: userData.user.id,
  });

  return facture.id;
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

// ---------- Suppression d'un document erroné ----------
// Autorisé pour tout le monde (RLS restreint déjà : l'admin/super_admin peut
// tout supprimer dans son organisation, un commercial seulement ses propres
// documents — voir policy `documents_delete`, migration 0011). Refusé si un
// paiement a déjà été enregistré dessus : on ne veut jamais perdre un
// historique financier par erreur ; il faut d'abord annuler/rembourser le
// paiement séparément.
export type DeleteDocumentResult =
  | { ok: false; error: string; needsPaymentConfirmation?: false }
  | { ok: false; needsPaymentConfirmation: true; paidAmount: number; error?: undefined };

// Renvoie un résultat au lieu de lever une erreur : en production, Next.js
// remplace le message de toute erreur levée dans une Server Action par un
// texte générique en anglais ("An error occurred in the Server Components
// render..."), qui empêchait de comprendre pourquoi une facture ne partait
// pas. En cas de succès, redirige vers la liste des documents.
export async function deleteDocument(documentId: string, withPayments = false): Promise<DeleteDocumentResult> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, error: 'Session expirée, reconnectez-vous.' };

  const { error } = await supabase.rpc('delete_document_secure', {
    p_document_id: documentId,
    p_with_payments: withPayments,
  });

  if (error) {
    if (error.message.includes('PAIEMENTS_A_CONFIRMER')) {
      const { data: doc } = await supabase.from('documents').select('amount_paid').eq('id', documentId).maybeSingle();
      return { ok: false, needsPaymentConfirmation: true, paidAmount: Number(doc?.amount_paid ?? 0) };
    }
    if (error.message.includes('delete_document_secure')) {
      return {
        ok: false,
        error: "La fonction de suppression n'est pas encore installée dans la base (migration 0023 à exécuter dans Supabase).",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath('/documents');
  revalidatePath('/dashboard');
  redirect('/documents');
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
