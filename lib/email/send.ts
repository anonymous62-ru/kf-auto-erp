// Envoi d'un e-mail transactionnel via l'API HTTP de Resend (sans SDK).
// SERVEUR UNIQUEMENT : la clé RESEND_API_KEY ne doit jamais atteindre le
// navigateur (pas de préfixe NEXT_PUBLIC_, jamais importé dans un composant
// client).

export interface EmailConfig {
  apiKey: string | null;
  from: string;
  appUrl: string;
}

export function getEmailConfig(): EmailConfig {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://kf-auto-erp.vercel.app').replace(/\/+$/, '');
  return {
    apiKey: process.env.RESEND_API_KEY?.trim() || null,
    from: process.env.EMAIL_FROM?.trim() || 'KF Auto ERP <notifications@kfauto.tg>',
    appUrl,
  };
}

export interface OutgoingEmail {
  to: string;
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  // Identifiant stable (id de la file) : Resend ignore un second envoi avec
  // la même clé pendant 24 h, ce qui évite les doublons en cas de nouvelle
  // tentative après une coupure réseau.
  idempotencyKey?: string;
}

export type SendResult = { ok: true; id: string | null } | { ok: false; error: string; status?: number };

export async function sendEmail(email: OutgoingEmail, config = getEmailConfig()): Promise<SendResult> {
  if (!config.apiKey) return { ok: false, error: 'RESEND_API_KEY non configurée' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        ...(email.idempotencyKey ? { 'Idempotency-Key': email.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: config.from,
        to: [email.to],
        ...(email.cc && email.cc.length > 0 ? { cc: email.cc } : {}),
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      signal: controller.signal,
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => null)) as { id?: string; message?: string; name?: string } | null;
    if (!res.ok) {
      return { ok: false, status: res.status, error: `Resend ${res.status} : ${body?.message ?? body?.name ?? res.statusText}`.slice(0, 500) };
    }
    return { ok: true, id: body?.id ?? null };
  } catch (e) {
    const message = e instanceof Error ? (e.name === 'AbortError' ? 'Délai dépassé (15 s)' : e.message) : String(e);
    return { ok: false, error: message.slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}
