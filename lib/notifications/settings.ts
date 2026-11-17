'use server';

// Réglages de notification de l'utilisateur connecté + e-mail de test.
// Renvoie { error } plutôt que de lever (message lisible en production).

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getEmailConfig, sendEmail } from '@/lib/email/send';
import { renderEmail } from '@/lib/email/templates';

export async function setEmailNonUrgent(value: boolean): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: 'Session expirée, reconnectez-vous.' };
  const { error } = await supabase
    .from('profiles')
    .update({ email_non_urgent: !!value })
    .eq('id', data.user.id);
  if (error) return { error: "Le réglage n'a pas pu être enregistré." };
  revalidatePath('/settings/notifications');
  return {};
}

// Réservé au super admin : s'envoie un e-mail de démonstration (modèle
// « action ») pour vérifier la configuration Resend et le domaine.
export async function sendTestEmail(): Promise<{ error?: string; to?: string }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: 'Session expirée, reconnectez-vous.' };
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, email, full_name')
    .eq('id', data.user.id)
    .maybeSingle();
  if (profile?.role !== 'super_admin') return { error: 'Réservé au super admin.' };
  const to = profile.email || data.user.email;
  if (!to) return { error: 'Aucune adresse e-mail sur votre compte.' };

  const config = getEmailConfig();
  if (!config.apiKey) return { error: "RESEND_API_KEY n'est pas configurée dans Vercel." };

  const rendered = renderEmail(
    {
      template: 'action',
      category: 'validation',
      kind: 'proforma_a_valider',
      payload: {
        title: 'E-mail de test',
        message: "Ceci est un e-mail de test : la configuration de l'envoi fonctionne.",
        link: '/settings/notifications',
        document_type: 'devis',
        document_number: 'TEST',
        client: 'Client de démonstration',
        amount: 1000000,
        requester: profile.full_name ?? 'Super admin',
      },
    },
    config.appUrl
  );
  const res = await sendEmail({ to, subject: `[Test] ${rendered.subject}`, html: rendered.html, text: rendered.text }, config);
  if (!res.ok) return { error: `Échec de l'envoi : ${res.error}` };
  return { to };
}
