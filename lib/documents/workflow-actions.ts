'use server';

// Circuit de vente (direction, 16/11/2026) : proforma -> bon de commande ->
// facture. Chaque étape passe par une fonction PostgreSQL (migration 0044)
// qui vérifie le rôle, l'état de départ (un double clic est refusé), écrit
// l'historique et déclenche les notifications. Les actions renvoient
// { error } au lieu de lever une erreur : en production, Next.js masque le
// message des erreurs.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type WorkflowActionResult = { error: string } | undefined;

function readable(message: string | undefined, fallback: string) {
  const text = (message ?? '').trim();
  if (/Could not find the function|does not exist/i.test(text)) {
    return "Cette étape n'est pas encore installée dans la base (migration 0044).";
  }
  return text || fallback;
}

function refresh(documentId: string) {
  revalidatePath('/documents');
  revalidatePath(`/documents/${documentId}`);
  revalidatePath('/dashboard');
}

async function call(
  fn: string,
  args: Record<string, unknown>,
  documentId: string,
  fallback: string
): Promise<WorkflowActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: readable(error.message, fallback) };
  refresh(documentId);
  return undefined;
}

function needReason(reason: string) {
  return reason.trim().length < 3 ? { error: 'Indiquez le motif (au moins 3 caractères).' } : null;
}

// ---------- Proforma ----------

export async function submitProforma(documentId: string) {
  return call('submit_proforma', { p_id: documentId }, documentId, 'La soumission a échoué.');
}

// La signature du N+1 est déposée dans le bucket privé document-signatures
// par le navigateur (même stockage que la signature commerciale), puis son
// adresse est enregistrée ici avec la validation.
export async function validateProforma(documentId: string, signatureUrl: string) {
  if (!signatureUrl) return { error: 'Signez la proforma avant de la valider.' };
  return call('validate_proforma', { p_id: documentId, p_n1_signature_url: signatureUrl }, documentId, 'La validation a échoué.');
}

export async function refuseProforma(documentId: string, reason: string) {
  const bad = needReason(reason);
  if (bad) return bad;
  return call('refuse_proforma', { p_id: documentId, p_reason: reason.trim() }, documentId, 'Le refus a échoué.');
}

export async function markProformaSent(documentId: string) {
  return call('mark_proforma_sent', { p_id: documentId }, documentId, "L'envoi n'a pas pu être enregistré.");
}

export async function markProformaAccepted(documentId: string) {
  return call('mark_proforma_accepted', { p_id: documentId }, documentId, "L'accord du client n'a pas pu être enregistré.");
}

// ---------- Bon de commande ----------

export async function checkCommande(documentId: string, conforme: boolean, reason = '') {
  if (!conforme) {
    const bad = needReason(reason);
    if (bad) return bad;
  }
  return call(
    'check_commande',
    { p_id: documentId, p_conforme: conforme, p_reason: conforme ? null : reason.trim() },
    documentId,
    'La vérification a échoué.'
  );
}

export async function resubmitCommande(documentId: string) {
  return call('resubmit_commande', { p_id: documentId }, documentId, 'Le renvoi a échoué.');
}

export async function prepareInvoice(commandeId: string, vehicleUnitIds: string[]) {
  return call(
    'prepare_invoice',
    { p_commande_id: commandeId, p_vehicle_unit_ids: vehicleUnitIds },
    commandeId,
    "La préparation de la facture a échoué."
  );
}

export async function validateInvoice(commandeId: string) {
  return call('validate_invoice', { p_commande_id: commandeId }, commandeId, 'La validation a échoué.');
}

export async function refuseInvoice(commandeId: string, reason: string) {
  const bad = needReason(reason);
  if (bad) return bad;
  return call('refuse_invoice', { p_commande_id: commandeId, p_reason: reason.trim() }, commandeId, 'Le refus a échoué.');
}

// Émission définitive : le numéro de facture est attribué ici, une seule fois.
export async function issueFinalInvoice(commandeId: string): Promise<WorkflowActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('issue_final_invoice', { p_commande_id: commandeId });
  if (error || !data) return { error: readable(error?.message, "L'émission de la facture a échoué.") };
  refresh(commandeId);
  redirect(`/documents/${data as string}`);
}
