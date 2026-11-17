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
// la page Impayés) : évite qu'une relance automatique reparte le même jour.
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

// ---------------------------------------------------------------------------
// Paiement en plusieurs fois (migration 0045)
// ---------------------------------------------------------------------------

type InstallmentRow = { amount: number; dueDate: string };

function rpcError(message: string): string {
  if (/permission denied|not allowed|row-level security/i.test(message)) {
    return "Vous n'avez pas le droit d'effectuer cette opération.";
  }
  return message;
}

function toJsonSchedule(rows: InstallmentRow[] | null | undefined) {
  if (!rows || rows.length === 0) return null;
  return rows.map((r) => ({ amount: Math.round(r.amount), due_date: r.dueDate }));
}

// Enregistre le paiement (acompte) puis, si fourni, remplace l'échéancier du
// reste. Le contrôle « total des échéances = reste dû » est refait en base.
// requestId : identifiant unique de la saisie (anti double clic / renvoi).
export async function recordPaymentWithSchedule(input: {
  documentId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentDate: string;
  reference?: string;
  notes?: string;
  installments?: InstallmentRow[] | null;
  requestId: string;
}): Promise<{ ok: true; duplicate: boolean } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, error: 'Session expirée, reconnectez-vous.' };
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { ok: false, error: 'Le montant doit être positif.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate)) return { ok: false, error: 'Date de paiement invalide.' };

  const { data, error } = await supabase.rpc('record_payment_with_schedule', {
    p_document_id: input.documentId,
    p_amount: input.amount,
    p_method: input.paymentMethod,
    p_date: input.paymentDate,
    p_reference: input.reference ?? null,
    p_notes: input.notes ?? null,
    p_installments: toJsonSchedule(input.installments),
    p_request_id: input.requestId,
  });
  if (error) return { ok: false, error: rpcError(error.message) };

  revalidatePath(`/documents/${input.documentId}`);
  revalidatePath('/impayes');
  revalidatePath('/dashboard');
  return { ok: true, duplicate: Boolean((data as { duplicate?: boolean } | null)?.duplicate) };
}

export async function setPaymentSchedule(
  documentId: string,
  installments: InstallmentRow[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_payment_schedule', {
    p_document_id: documentId,
    p_installments: toJsonSchedule(installments),
  });
  if (error) return { ok: false, error: rpcError(error.message) };
  revalidatePath(`/documents/${documentId}`);
  revalidatePath('/impayes');
  return { ok: true };
}

export async function confirmPayment(paymentId: string, documentId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('confirm_payment', { p_payment_id: paymentId });
  if (error) return { ok: false, error: rpcError(error.message) };
  revalidatePath(`/documents/${documentId}`);
  return { ok: true };
}

export type Installment = {
  id: string;
  seq: number;
  due_date: string;
  amount: number;
  paid_amount: number;
  status: 'a_venir' | 'payee' | 'en_retard';
};

// Échéancier en cours (hors échéances remplacées), dans l'ordre.
export async function getInstallments(documentId: string): Promise<Installment[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('payment_installments')
    .select('id, seq, due_date, amount, paid_amount, status')
    .eq('document_id', documentId)
    .is('replaced_at', null)
    .order('seq');
  return (data ?? []).map((r) => ({ ...r, amount: Number(r.amount), paid_amount: Number(r.paid_amount) })) as Installment[];
}

// Pour le formulaire de paiement : un échéancier est-il déjà en cours ?
export async function getScheduleSummary(documentId: string): Promise<{ open: number }> {
  const supabase = await createClient();
  const { count } = await supabase
    .from('payment_installments')
    .select('id', { count: 'exact', head: true })
    .eq('document_id', documentId)
    .is('replaced_at', null)
    .neq('status', 'payee');
  return { open: count ?? 0 };
}

export async function getUnconfirmedPayments(documentId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('payments')
    .select('id, amount, payment_method, payment_date, profiles:recorded_by (full_name)')
    .eq('document_id', documentId)
    .is('confirmed_at', null)
    .order('payment_date');
  return (data ?? []).map((p) => {
    const author = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
    return {
      id: p.id as string,
      amount: Number(p.amount),
      payment_method: p.payment_method as string,
      payment_date: p.payment_date as string,
      recorded_by_name: (author as { full_name?: string } | null)?.full_name ?? null,
    };
  });
}

// Échéances non soldées de toutes les factures visibles (page Impayés).
export async function getOpenInstallments() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('payment_installments')
    .select(
      'id, seq, due_date, amount, paid_amount, status, document_id, documents!inner (id, document_number, status, clients (first_name, last_name, company_name, phone, email))'
    )
    .is('replaced_at', null)
    .neq('status', 'payee')
    .order('due_date', { ascending: true });
  if (error) return [];
  return (data ?? [])
    .map((r) => {
      const doc = Array.isArray(r.documents) ? r.documents[0] : r.documents;
      const client = doc ? (Array.isArray(doc.clients) ? doc.clients[0] : doc.clients) : null;
      return {
        id: r.id as string,
        seq: r.seq as number,
        due_date: r.due_date as string,
        amount: Number(r.amount),
        paid_amount: Number(r.paid_amount),
        status: r.status as 'a_venir' | 'payee' | 'en_retard',
        document_id: r.document_id as string,
        document_number: (doc?.document_number as string | null) ?? null,
        document_status: (doc?.status as string | undefined) ?? '',
        client: client as { first_name?: string; last_name?: string; company_name?: string; phone?: string; email?: string } | null,
      };
    })
    .filter((r) => r.document_status !== 'annule' && r.document_status !== 'paye');
}
