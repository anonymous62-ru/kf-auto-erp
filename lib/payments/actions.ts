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

export async function createPayment(input: {
  documentId: string;
  clientId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  reference?: string;
  notes?: string;
}) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifie');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile) throw new Error('Profil introuvable');

  if (input.amount <= 0) throw new Error('Le montant doit être positif');

  const { error } = await supabase.from('payments').insert({
    organization_id: profile.organization_id,
    document_id: input.documentId,
    client_id: input.clientId,
    amount: input.amount,
    payment_method: input.paymentMethod,
    reference: input.reference,
    notes: input.notes,
    recorded_by: userData.user.id,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/documents/${input.documentId}`);
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
    .gt('balance_due', 0)
    .in('status', ['envoye', 'paye_partiel'])
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
