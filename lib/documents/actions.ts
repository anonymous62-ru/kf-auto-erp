'use server';

import { createClient } from '@/lib/supabase/server';
import { computeDocumentTotals, type DocumentItemInput } from '@/lib/documents/calculations';
import { applyFactureStockDeduction } from '@/lib/documents/stock-deduction';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { applyClientSearch } from '@/lib/search';

export type DocumentType = 'proforma' | 'devis' | 'commande' | 'facture' | 'bon_livraison' | 'recu' | 'avoir';

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
  const issueDate = new Date();
  const dueDate = new Date(issueDate);
  dueDate.setMonth(dueDate.getMonth() + 1);

  // Numéro officiel attribué par la base dans la même transaction que
  // l'insertion (trigger assign_document_number, migration 0037) : une
  // facture ne peut ni sauter un numéro ni en recevoir un en double.
  const { data: document, error: documentError } = await supabase
    .from('documents')
    .insert({
      organization_id: profile.organization_id,
      document_type: input.documentType,
      document_number: null,
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

// ---------- Conversions : Facture proforma -> Commande -> Facture ----------
// Circuit de vente (direction, 09/10) : le commercial passe sa facture
// proforma en commande ; seule l'administration des ventes transforme une
// commande en facture (ce qui retire le véhicule du stock). Tout se fait dans
// la fonction PostgreSQL convert_document (migration 0032), qui vérifie les
// droits, attribue le numéro, copie les lignes et renvoie le document déjà
// créé en cas de double clic.
// Renvoie { error } en cas de refus (message lisible en production, où
// Next.js masque les erreurs levées) ; redirige vers le nouveau document.
export async function convertDocument(
  sourceDocumentId: string,
  target: 'commande' | 'facture'
): Promise<{ error: string } | undefined> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('convert_document', {
    p_source_id: sourceDocumentId,
    p_target: target,
  });
  if (error || !data) {
    const message = error?.message ?? '';
    if (/convert_document/.test(message)) {
      return { error: "La conversion n'est pas encore installée dans la base (migration 0032)." };
    }
    return { error: message || 'La conversion a échoué.' };
  }
  revalidatePath('/documents');
  revalidatePath(`/documents/${sourceDocumentId}`);
  revalidatePath('/dashboard');
  redirect(`/documents/${data as string}`);
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

  // Seul un brouillon passe à « envoyé » (une facture émise, payée ou
  // annulée garde son statut).
  await supabase.from('documents').update({ status: 'envoye' }).eq('id', input.documentId).eq('status', 'brouillon');
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
