'use server';

// Annulation et avoirs (sécurité des factures, 10/10 puis 12/10/2026).
// Tout passe par des fonctions PostgreSQL (migration 0037) qui vérifient les
// droits et tracent l'opération. Les actions renvoient { error } au lieu de
// lever une erreur : en production, Next.js masque le message des erreurs.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type InvoiceActionResult = { error: string } | undefined;

export type AvoirLineInput = {
  designation: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
};

function readable(message: string | undefined, fallback: string) {
  const text = (message ?? '').trim();
  if (/issue_invoice|cancel_draft_invoice|create_avoir/.test(text) && /function|fonction/i.test(text)) {
    return "Cette fonction n'est pas encore installée dans la base (migration 0037).";
  }
  return text || fallback;
}

function refresh(documentId: string) {
  revalidatePath('/documents');
  revalidatePath(`/documents/${documentId}`);
  revalidatePath('/dashboard');
}

export async function cancelDraftInvoice(documentId: string, reason: string): Promise<InvoiceActionResult> {
  if (reason.trim().length < 3) return { error: "Indiquez le motif de l'annulation." };
  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_draft_invoice', { p_document_id: documentId, p_reason: reason.trim() });
  if (error) return { error: readable(error.message, "L'annulation a échoué.") };
  refresh(documentId);
  return undefined;
}

// lines = null : avoir total (la facture est annulée, le stock et les
// véhicules reviennent, la commande peut être refacturée).
export async function createAvoir(
  factureId: string,
  reason: string,
  lines: AvoirLineInput[] | null
): Promise<InvoiceActionResult> {
  if (reason.trim().length < 3) return { error: "Indiquez le motif de l'avoir." };
  if (lines) {
    if (lines.length === 0) return { error: "Ajoutez au moins une ligne à l'avoir." };
    for (const l of lines) {
      if (!l.designation.trim()) return { error: 'Chaque ligne doit avoir une désignation.' };
      if (!(l.quantity > 0)) return { error: 'La quantité doit être supérieure à zéro.' };
      if (!(l.unitPrice > 0)) return { error: 'Le montant de chaque ligne doit être supérieur à zéro.' };
    }
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_avoir', {
    p_facture_id: factureId,
    p_reason: reason.trim(),
    p_lines: lines
      ? lines.map((l) => ({
          designation: l.designation.trim(),
          quantity: l.quantity,
          unit_price: l.unitPrice,
          tax_rate: l.taxRate,
          discount_percent: 0,
        }))
      : null,
  });
  if (error || !data) return { error: readable(error?.message, "L'avoir n'a pas pu être créé.") };
  refresh(factureId);
  redirect(`/documents/${data as string}`);
}
