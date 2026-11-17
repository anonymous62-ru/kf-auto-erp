// Traitement de la file d'envoi des e-mails (table email_outbox).
// SERVEUR UNIQUEMENT (client service_role) : appelé par la route
// /api/cron/notifications (pg_cron toutes les 10 minutes + cron Vercel
// quotidien de secours).
//
// - Verrouillage par ligne : chaque e-mail est « réservé » par une mise à
//   jour conditionnelle (next_attempt_at repoussé de 5 min) ; deux
//   exécutions qui se chevauchent ne peuvent pas envoyer le même e-mail.
// - Échec : nouvelle tentative après 1, 5, 15, 60 puis 240 minutes ;
//   statut « echec » après 6 tentatives.
// - Sans RESEND_API_KEY : rien n'est envoyé, rien n'est compté, la file
//   attend la configuration.
// - Le journal d'audit est alimenté par un trigger en base (passage à
//   « envoye » ou « echec »).

import { createAdminClient } from '@/lib/supabase/admin';
import { getEmailConfig, sendEmail } from '@/lib/email/send';
import { renderEmail } from '@/lib/email/templates';

const MAX_ATTEMPTS = 6;
const BACKOFF_MINUTES = [1, 5, 15, 60, 240];
const LOCK_MINUTES = 5;

export interface OutboxResult {
  configured: boolean;
  pending?: number;
  processed: number;
  sent: number;
  retried: number;
  failed: number;
  ignored: number;
  message?: string;
}

interface OutboxRow {
  id: string;
  to_email: string;
  cc_emails: string[] | null;
  category: string;
  template: string;
  payload: Record<string, unknown> | null;
  action_item_id: string | null;
  attempts: number;
}

// 10 e-mails par passage au plus : 10 x 15 s de délai maximal restent sous la
// limite de 60 s de la route (le reste part au passage suivant).
export async function processOutbox(limit = 10): Promise<OutboxResult> {
  const config = getEmailConfig();
  const admin = createAdminClient();
  const result: OutboxResult = { configured: !!config.apiKey, processed: 0, sent: 0, retried: 0, failed: 0, ignored: 0 };

  if (!config.apiKey) {
    const { count } = await admin
      .from('email_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'en_attente');
    result.pending = count ?? 0;
    result.message = "RESEND_API_KEY n'est pas configurée : aucun e-mail envoyé, la file reste en attente.";
    return result;
  }

  const nowIso = new Date().toISOString();
  const { data: candidates, error } = await admin
    .from('email_outbox')
    .select('id')
    .eq('status', 'en_attente')
    .lte('next_attempt_at', nowIso)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  for (const c of candidates ?? []) {
    // Réservation atomique : seule l'exécution qui modifie la ligne l'envoie.
    const lockUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
    const { data: claimed } = await admin
      .from('email_outbox')
      .update({ next_attempt_at: lockUntil })
      .eq('id', c.id)
      .eq('status', 'en_attente')
      .lte('next_attempt_at', new Date().toISOString())
      .select('id, to_email, cc_emails, category, template, payload, action_item_id, attempts')
      .maybeSingle();
    if (!claimed) continue;
    const row = claimed as OutboxRow;
    result.processed++;

    // Action déjà traitée avant l'envoi : inutile de déranger le destinataire.
    let kind: string | null = null;
    if (row.action_item_id) {
      const { data: action } = await admin
        .from('action_items')
        .select('kind, status')
        .eq('id', row.action_item_id)
        .maybeSingle();
      kind = action?.kind ?? null;
      if (action && action.status !== 'ouverte' && (row.category === 'validation' || row.category === 'rappel')) {
        await admin
          .from('email_outbox')
          .update({ status: 'ignore', last_error: "Action déjà traitée avant l'envoi" })
          .eq('id', row.id);
        result.ignored++;
        continue;
      }
    }

    const payload = row.payload ?? {};
    let rendered;
    try {
      rendered = renderEmail(
        { template: row.template, category: row.category, payload, ccEmails: row.cc_emails ?? [], kind },
        config.appUrl
      );
    } catch (e) {
      await admin
        .from('email_outbox')
        .update({
          status: 'echec',
          attempts: row.attempts + 1,
          last_error: `Modèle illisible : ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
        })
        .eq('id', row.id);
      result.failed++;
      continue;
    }

    const cc = (row.cc_emails ?? []).filter((e) => e && e.toLowerCase() !== row.to_email.toLowerCase());
    const sent = await sendEmail(
      { to: row.to_email, cc, subject: rendered.subject, html: rendered.html, text: rendered.text, idempotencyKey: `kf-outbox-${row.id}` },
      config
    );
    const attempts = row.attempts + 1;
    const withSubject = { ...payload, subject: rendered.subject };

    if (sent.ok) {
      await admin
        .from('email_outbox')
        .update({
          status: 'envoye',
          sent_at: new Date().toISOString(),
          provider_id: sent.id,
          attempts,
          last_error: null,
          payload: withSubject,
        })
        .eq('id', row.id);
      result.sent++;
    } else if (attempts >= MAX_ATTEMPTS) {
      await admin
        .from('email_outbox')
        .update({ status: 'echec', attempts, last_error: sent.error, payload: withSubject })
        .eq('id', row.id);
      result.failed++;
    } else {
      const wait = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
      await admin
        .from('email_outbox')
        .update({
          attempts,
          last_error: sent.error,
          next_attempt_at: new Date(Date.now() + wait * 60000).toISOString(),
        })
        .eq('id', row.id);
      result.retried++;
    }
  }
  return result;
}
