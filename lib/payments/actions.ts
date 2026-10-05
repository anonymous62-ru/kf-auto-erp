'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export type PaymentMethod =
  | 'especes'
  | 'virement'
  | 'cheque'
  | 'mobile_money_flooz'
  | 'mobile_money_tmoney'
  | 'autre';

// Renvoie { ok, error } au lieu de lever une erreur : en production, Next.js
// masque le message des erreurs levées dans une Server Action, et la
// caissière ne verrait pas pourquoi un paiement est refusé (montant
// supérieur au solde, droits...).
export async function createPayment(input: {
  documentId: string;
  clientId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  reference?: string;
  notes?: string;
  paymentDate?: string; // AAAA-MM-JJ, aujourd'hui par défaut
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, error: 'Session expirée, reconnectez-vous.' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (!profile) return { ok: false, error: 'Profil introuvable.' };

  if (!Number.isFinite(input.amount) || input.amount <= 0) return { ok: false, error: 'Le montant doit être positif.' };

  const today = new Date().toISOString().slice(0, 10);
  let paymentDate = today;
  if (input.paymentDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate)) return { ok: false, error: 'Date de paiement invalide.' };
    if (input.paymentDate > today) return { ok: false, error: 'La date de paiement ne peut pas être dans le futur.' };
    const oldest = new Date();
    oldest.setFullYear(oldest.getFullYear() - 1);
    if (input.paymentDate < oldest.toISOString().slice(0, 10)) {
      return { ok: false, error: "La date de paiement ne peut pas remonter à plus d'un an." };
    }
    paymentDate = input.paymentDate;
  }

  const { error } = await supabase.from('payments').insert({
    organization_id: profile.organization_id,
    document_id: input.documentId,
    client_id: input.clientId,
    amount: input.amount,
    payment_method: input.paymentMethod,
    payment_date: paymentDate,
    reference: input.reference,
    notes: input.notes,
    recorded_by: userData.user.id,
  });
  if (error) {
    if (/row-level security/i.test(error.message)) {
      return { ok: false, error: "Vous n'avez pas le droit d'enregistrer un paiement sur ce document." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath(`/documents/${input.documentId}`);
  revalidatePath('/impayes');
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function getPayments(documentId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('payments')
    .select('id, amount, payment_method, payment_date, reference')
    .eq('document_id', documentId)
    .order('payment_date', { ascending: false });
  return data ?? [];
}

export async function getUnpaidDocuments() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('documents')
    .select(
      'id, document_number, document_type, total_amount, amount_paid, balance_due, due_date, status, last_reminder_at, clients(first_name, last_name, company_name, phone, email)'
    )
    // Factures uniquement (un devis envoyé n'est pas un impayé), y compris
    // celles restées en brouillon après une remise en main propre.
    .eq('document_type', 'facture')
    .gt('balance_due', 0)
    .not('status', 'in', '(paye,annule)')
    .order('due_date', { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Marque une relance comme envoyée manuellement (bouton WhatsApp/Email sur
// la page Impayés) — évite qu'une relance automatique reparte le même jour.
export async function markReminderSent(documentId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from('documents')
    .update({ last_reminder_at: new Date().toISOString() })
    .eq('id', documentId);
  if (error) throw new Error(error.message);
  revalidatePath('/impayes');
}

// Relances automatiques : délègue à la fonction Postgres security-definer
// generate_overdue_reminders() (migration 0004), qui crée une notification
// pour chaque document impayé en retard depuis plus de 24h sans relance
// récente. Appelée depuis la synchronisation périodique côté client (pas de
// tâche planifiée serveur nécessaire) ; échoue silencieusement si la
// migration n'a pas encore été exécutée.
export async function checkOverdueReminders() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { notified: 0 };

  const { data, error } = await supabase.rpc('generate_overdue_reminders');
  if (error) return { notified: 0 };
  return { notified: typeof data === 'number' ? data : 0 };
}
