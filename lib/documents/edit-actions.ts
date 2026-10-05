'use server';

// Modification d'un document déjà créé (client, lignes, notes).
// Toute l'écriture passe par la fonction SQL update_document_secure
// (migration 0027) : contrôle des droits, refus si paiement, remise en stock
// et nouvelle sortie pour une facture, le tout dans une seule transaction.
//
// Les fonctions renvoient un résultat au lieu de lever une erreur : en
// production, Next.js masque le message des erreurs levées dans une Server
// Action.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { computeDocumentTotals } from '@/lib/documents/calculations';

const MANAGER_ROLES = ['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav'];
const COMMERCIAL_EDITABLE_STATUSES = ['brouillon', 'envoye'];

export type EditableDocumentItem = {
  productId?: string;
  designation: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  discountPercent: number;
};

export type EditableClient = {
  id: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  phone?: string;
  email?: string;
  address?: string;
};

export type DocumentForEdit = {
  id: string;
  documentType: string;
  documentNumber: string | null;
  status: string;
  notes: string;
  client: EditableClient | null;
  items: EditableDocumentItem[];
  canEdit: boolean;
  reason: string | null;
};

export type UpdateDocumentInput = {
  documentId: string;
  clientId: string;
  notes?: string;
  items: EditableDocumentItem[];
};

export type UpdateDocumentResult = { ok: true } | { ok: false; error: string };

function orUndefined(value: string | null | undefined) {
  return value ?? undefined;
}

export async function getDocumentForEdit(documentId: string): Promise<DocumentForEdit | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  const role = (me?.role as string | undefined) ?? '';

  const { data: doc } = await supabase
    .from('documents')
    .select(
      `id, document_type, document_number, status, commercial_id, amount_paid, notes, client_id,
       clients (id, first_name, last_name, company_name, phone, email, address)`
    )
    .eq('id', documentId)
    .maybeSingle();
  if (!doc) return null;

  const { data: itemRows } = await supabase
    .from('document_items')
    .select('product_id, designation, quantity, unit_price, tax_rate, discount_percent, position')
    .eq('document_id', documentId)
    .order('position');

  const { count: paymentCount } = await supabase
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('document_id', documentId);

  const rawClient = Array.isArray(doc.clients) ? doc.clients[0] : doc.clients;
  const client: EditableClient | null = rawClient
    ? {
        id: rawClient.id,
        first_name: orUndefined(rawClient.first_name),
        last_name: orUndefined(rawClient.last_name),
        company_name: orUndefined(rawClient.company_name),
        phone: orUndefined(rawClient.phone),
        email: orUndefined(rawClient.email),
        address: orUndefined(rawClient.address),
      }
    : null;

  let reason: string | null = null;
  const isManager = MANAGER_ROLES.includes(role);
  if (Number(doc.amount_paid ?? 0) > 0 || (paymentCount ?? 0) > 0) {
    reason =
      "Ce document a déjà un paiement enregistré : il ne peut pas être modifié. Un administrateur doit d'abord supprimer le paiement ou le document.";
  } else if (!isManager && doc.commercial_id !== user.id) {
    reason = 'Vous ne pouvez modifier que vos propres documents.';
  } else if (!isManager && !COMMERCIAL_EDITABLE_STATUSES.includes(doc.status)) {
    reason = 'Ce document ne peut plus être modifié par un commercial (il n\'est plus en brouillon ni envoyé). Demandez à un responsable.';
  } else if (!doc.document_number) {
    reason = "Ce document n'a pas encore de numéro officiel : attendez sa synchronisation avant de le modifier.";
  }

  return {
    id: doc.id,
    documentType: doc.document_type,
    documentNumber: doc.document_number,
    status: doc.status,
    notes: doc.notes ?? '',
    client,
    items: (itemRows ?? []).map((it) => ({
      productId: orUndefined(it.product_id),
      designation: it.designation,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unit_price),
      taxRate: Number(it.tax_rate ?? 0),
      discountPercent: Number(it.discount_percent ?? 0),
    })),
    canEdit: reason === null,
    reason,
  };
}

export async function updateDocument(input: UpdateDocumentInput): Promise<UpdateDocumentResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'Session expirée, reconnectez-vous.' };

    if (!input.documentId) return { ok: false, error: 'Document introuvable.' };
    if (!input.clientId) return { ok: false, error: 'Sélectionnez un client.' };
    if (input.clientId.startsWith('local:')) {
      return {
        ok: false,
        error: "Ce client a été créé hors-ligne et n'est pas encore synchronisé. Réessayez une fois la connexion revenue.",
      };
    }
    if (!Array.isArray(input.items) || input.items.length === 0) {
      return { ok: false, error: 'Ajoutez au moins un article.' };
    }

    const items = input.items.map((it) => ({
      productId: it.productId || undefined,
      designation: String(it.designation ?? '').trim(),
      quantity: Number(it.quantity),
      unitPrice: Number(it.unitPrice),
      taxRate: Number(it.taxRate),
      discountPercent: Number(it.discountPercent ?? 0),
    }));

    for (const it of items) {
      if (!it.designation) return { ok: false, error: 'Chaque article doit avoir une désignation.' };
      if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
        return { ok: false, error: 'La quantité de chaque article doit être supérieure à zéro.' };
      }
      if (!Number.isFinite(it.unitPrice) || it.unitPrice < 0) {
        return { ok: false, error: 'Le prix unitaire ne peut pas être négatif.' };
      }
      if (!Number.isFinite(it.taxRate) || it.taxRate < 0 || it.taxRate > 100) {
        return { ok: false, error: 'Taux de TVA invalide.' };
      }
      if (!Number.isFinite(it.discountPercent) || it.discountPercent < 0 || it.discountPercent > 100) {
        return { ok: false, error: 'Remise invalide (entre 0 et 100 %).' };
      }
    }

    // Recalcul côté serveur, exactement comme à la création.
    const totals = computeDocumentTotals(items);

    const { error } = await supabase.rpc('update_document_secure', {
      p_document_id: input.documentId,
      p_client_id: input.clientId,
      p_notes: input.notes ?? null,
      p_items: items.map((it, index) => ({
        product_id: it.productId ?? null,
        designation: it.designation,
        quantity: it.quantity,
        unit_price: it.unitPrice,
        tax_rate: it.taxRate,
        discount_percent: it.discountPercent,
        position: index,
      })),
      p_subtotal: totals.subtotal,
      p_tax_amount: totals.taxAmount,
      p_total_amount: totals.totalAmount,
    });

    if (error) {
      if (error.code === 'PGRST202' || /schema cache|could not find the function/i.test(error.message)) {
        return {
          ok: false,
          error: "La fonction de modification n'est pas encore installée dans la base (migration 0027 à exécuter dans Supabase).",
        };
      }
      return { ok: false, error: error.message };
    }

    revalidatePath(`/documents/${input.documentId}`);
    revalidatePath('/documents');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur lors de la modification du document.' };
  }
}
