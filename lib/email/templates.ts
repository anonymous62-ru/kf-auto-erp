// Modèles des e-mails de notification (HTML compatible clients mail : tables,
// styles en ligne, aucune image distante) + version texte.
// Tout contenu venant de la base est échappé avant insertion dans le HTML.

import {
  ACTION_KIND_VERBS,
  actionKindLabel,
  documentTypeLabel,
  formatFcfa,
  safeInternalPath,
} from '@/lib/notifications/labels';

const NUIT = '#0D1B2E';
const ROUGE = '#D7262E';
const FOND = '#F5F6F8';
const TEXTE = '#1F2937';
const GRIS = '#6B7280';
const TRAIT = '#E5E7EB';
const FONT = "font-family:Arial,Helvetica,sans-serif;";

export interface EmailInput {
  template: string; // action | info | rappel | recapitulatif
  category: string; // validation | info | rappel | recapitulatif
  payload: Record<string, unknown>;
  ccEmails?: string[];
  kind?: string | null; // type de l'action liée (action_items.kind)
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[\r\n]+/g, ' ').trim();
}

// Sujet : une seule ligne, sans caractère de contrôle, longueur raisonnable.
function cleanSubject(s: string) {
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function formatDateFr(iso: unknown) {
  const s = str(iso);
  if (!s) return '';
  const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lome' });
}

function ageLabel(hours: number) {
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} j ${rest} h` : `${days} j`;
}

function ageHoursFrom(iso: unknown, now = Date.now()) {
  const t = new Date(str(iso)).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 3600000));
}

interface Detail {
  label: string;
  value: string;
}

function documentLine(p: Record<string, unknown>) {
  const type = documentTypeLabel(str(p.document_type));
  const number = str(p.document_number);
  return [type, number].filter(Boolean).join(' ');
}

function actionDetails(p: Record<string, unknown>, kind: string | null | undefined): Detail[] {
  const rows: Detail[] = [];
  const k = kind || str(p.kind);
  rows.push({ label: "Type d'action", value: k ? actionKindLabel(k) : str(p.title) });
  const doc = documentLine(p);
  if (doc) rows.push({ label: 'Document', value: doc });
  if (str(p.client)) rows.push({ label: 'Client', value: str(p.client) });
  const amount = formatFcfa(p.amount);
  if (amount) rows.push({ label: 'Montant', value: amount });
  const requester = str(p.requester) || str(p.requested_by_name);
  if (requester) rows.push({ label: 'Demandeur', value: requester });
  if (str(p.assignee) && p.escalated) rows.push({ label: 'Destinataire', value: str(p.assignee) });
  if (str(p.due_date)) rows.push({ label: 'Échéance', value: formatDateFr(p.due_date) || str(p.due_date) });
  return rows;
}

// ---------------------------------------------------------------------------
// Mise en page commune
// ---------------------------------------------------------------------------
function layout(opts: { preheader: string; heading: string; intro?: string; body: string; buttonUrl?: string; buttonLabel?: string; footerNote?: string }) {
  const button = opts.buttonUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px 0;">
        <tr><td bgcolor="${ROUGE}" style="border-radius:6px;">
          <a href="${escapeHtml(opts.buttonUrl)}" target="_blank" style="display:inline-block;padding:12px 22px;${FONT}font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:6px;">${escapeHtml(opts.buttonLabel ?? "Ouvrir dans l'application")}</a>
        </td></tr>
      </table>`
    : '';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(opts.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${FOND};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${FOND};">${escapeHtml(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${FOND}" style="background-color:${FOND};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#FFFFFF;border:1px solid ${TRAIT};border-radius:8px;overflow:hidden;">
      <tr><td bgcolor="${NUIT}" style="background-color:${NUIT};padding:18px 24px;${FONT}font-size:17px;font-weight:bold;color:#FFFFFF;letter-spacing:0.2px;">
        KF Auto <span style="color:#9FB0C6;font-weight:normal;">ERP</span>
      </td></tr>
      <tr><td bgcolor="${ROUGE}" style="background-color:${ROUGE};height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>
      <tr><td style="padding:28px 24px 8px 24px;${FONT}color:${TEXTE};">
        <h1 style="margin:0 0 12px 0;${FONT}font-size:20px;line-height:1.3;color:${NUIT};">${escapeHtml(opts.heading)}</h1>
        ${opts.intro ? `<p style="margin:0 0 16px 0;${FONT}font-size:15px;line-height:1.5;color:${TEXTE};">${escapeHtml(opts.intro)}</p>` : ''}
        ${opts.body}
        ${button}
      </td></tr>
      <tr><td style="padding:16px 24px 24px 24px;${FONT}font-size:12px;line-height:1.5;color:${GRIS};border-top:1px solid ${TRAIT};">
        ${opts.footerNote ? `${escapeHtml(opts.footerNote)}<br>` : ''}
        Connexion requise. Aucune validation n'est possible depuis cet e-mail.<br>
        Message automatique de KF Auto ERP (KF Auto Sarl, Chery Togo). Merci de ne pas y répondre.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function detailsTable(rows: Detail[]) {
  if (rows.length === 0) return '';
  const trs = rows
    .map(
      (r, i) => `<tr>
        <td style="padding:9px 12px;${FONT}font-size:13px;color:${GRIS};width:140px;vertical-align:top;${i > 0 ? `border-top:1px solid ${TRAIT};` : ''}">${escapeHtml(r.label)}</td>
        <td style="padding:9px 12px;${FONT}font-size:14px;color:${TEXTE};font-weight:bold;vertical-align:top;${i > 0 ? `border-top:1px solid ${TRAIT};` : ''}">${escapeHtml(r.value)}</td>
      </tr>`
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${TRAIT};border-radius:6px;background-color:#FAFBFC;">${trs}</table>`;
}

function detailsText(rows: Detail[]) {
  return rows.map((r) => `${r.label} : ${r.value}`).join('\n');
}

const TEXT_FOOTER =
  "Connexion requise. Aucune validation n'est possible depuis cet e-mail.\nMessage automatique de KF Auto ERP (KF Auto Sarl, Chery Togo).";

// ---------------------------------------------------------------------------
// Modèles
// ---------------------------------------------------------------------------
function subjectParts(p: Record<string, unknown>) {
  const doc = documentLine(p);
  return [doc ? doc.charAt(0).toLowerCase() + doc.slice(1) : '', str(p.client), formatFcfa(p.amount) ?? ''].filter(Boolean);
}

function renderAction(input: EmailInput, appUrl: string): RenderedEmail {
  const p = input.payload;
  const kind = input.kind || str(p.kind);
  const verb = (kind && ACTION_KIND_VERBS[kind]) || 'À traiter';
  const parts = subjectParts(p);
  const subject = cleanSubject(parts.length > 0 ? `${verb} : ${parts.join(', ')}` : `${verb} : ${str(p.title)}`);
  const url = appUrl + safeInternalPath(p.link);
  const rows = actionDetails(p, kind);
  const heading = str(p.title) || actionKindLabel(kind);
  const intro = str(p.message) || 'Une action attend votre validation dans KF Auto ERP.';
  return {
    subject,
    html: layout({ preheader: subject, heading, intro, body: detailsTable(rows), buttonUrl: url }),
    text: `${heading}\n\n${intro}\n\n${detailsText(rows)}\n\nOuvrir dans l'application : ${url}\n\n${TEXT_FOOTER}\n`,
  };
}

function renderInfo(input: EmailInput, appUrl: string): RenderedEmail {
  const p = input.payload;
  const subject = cleanSubject(str(p.title) || 'Notification KF Auto ERP');
  const link = p.link ? appUrl + safeInternalPath(p.link, '/dashboard') : undefined;
  const rows: Detail[] = [];
  const doc = documentLine(p);
  if (doc) rows.push({ label: 'Document', value: doc });
  if (str(p.client)) rows.push({ label: 'Client', value: str(p.client) });
  const amount = formatFcfa(p.amount);
  if (amount) rows.push({ label: 'Montant', value: amount });
  if (str(p.requester)) rows.push({ label: 'Par', value: str(p.requester) });
  const message = str(p.message);
  return {
    subject,
    html: layout({
      preheader: message || subject,
      heading: str(p.title) || 'Notification',
      intro: message,
      body: detailsTable(rows),
      buttonUrl: link,
      footerNote: 'Vous pouvez couper les e-mails d\'information dans Compte, Notifications.',
    }),
    text: `${str(p.title)}\n\n${message}\n\n${detailsText(rows)}${link ? `\n\nOuvrir dans l'application : ${link}` : ''}\n\n${TEXT_FOOTER}\n`,
  };
}

function renderRappel(input: EmailInput, appUrl: string): RenderedEmail {
  const p = input.payload;
  const kind = input.kind || str(p.kind);
  const escalated = p.escalated === true || p.escalated === 'true';
  const hours = ageHoursFrom(p.created_at);
  const age = hours !== null ? ageLabel(hours) : escalated ? 'plus de 48 h' : 'plus de 24 h';
  const parts = subjectParts(p);
  const label = parts.length > 0 ? parts.join(', ') : str(p.title);
  const subject = cleanSubject(`${escalated ? 'Rappel, direction en copie' : 'Rappel'} : ${label} (en attente depuis ${age})`);
  const url = appUrl + safeInternalPath(p.link);
  const rows = actionDetails(p, kind);
  rows.push({ label: 'En attente depuis', value: age });
  const intro = escalated
    ? `Cette action n'a pas été traitée depuis plus de 48 heures. La direction (DG et manager) est en copie de ce rappel.`
    : `Cette action attend toujours votre traitement depuis plus de 24 heures.`;
  const ccNote =
    escalated && input.ccEmails && input.ccEmails.length > 0
      ? `<p style="margin:16px 0 0 0;${FONT}font-size:13px;color:${GRIS};">En copie : ${escapeHtml(input.ccEmails.join(', '))}</p>`
      : '';
  const banner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;"><tr>
      <td style="border-left:4px solid ${escalated ? ROUGE : '#D97706'};background-color:${escalated ? '#FDECEC' : '#FEF6E7'};padding:10px 12px;${FONT}font-size:14px;color:${TEXTE};">${escapeHtml(intro)}</td>
    </tr></table>`;
  const heading = `Rappel : ${str(p.title) || actionKindLabel(kind)}`;
  return {
    subject,
    html: layout({ preheader: subject, heading, body: banner + detailsTable(rows) + ccNote, buttonUrl: url }),
    text: `${heading}\n\n${intro}\n\n${detailsText(rows)}${escalated && input.ccEmails?.length ? `\nEn copie : ${input.ccEmails.join(', ')}` : ''}\n\nOuvrir dans l'application : ${url}\n\n${TEXT_FOOTER}\n`,
  };
}

interface DigestItem {
  title?: unknown;
  link?: unknown;
  kind?: unknown;
  created_at?: unknown;
  age_hours?: unknown;
  document_number?: unknown;
  client?: unknown;
  amount?: unknown;
}

function renderRecapitulatif(input: EmailInput, appUrl: string): RenderedEmail {
  const p = input.payload;
  const items = (Array.isArray(p.items) ? p.items : []) as DigestItem[];
  const count = Number(p.count ?? items.length) || items.length;
  const date = formatDateFr(p.date) || formatDateFr(new Date().toISOString());
  const subject = cleanSubject(`Vos actions en attente : ${count} au ${date}`);
  const name = str(p.name);
  const intro = `${name ? `Bonjour ${name}, v` : 'V'}oici ${count > 1 ? `les ${count} actions qui attendent` : "l'action qui attend"} votre traitement ce matin.`;

  const rowsHtml = items
    .map((it, i) => {
      const hours = typeof it.age_hours === 'number' ? it.age_hours : ageHoursFrom(it.created_at) ?? 0;
      const color = hours >= 48 ? ROUGE : hours >= 24 ? '#B45309' : GRIS;
      const meta = [str(it.document_number), str(it.client), formatFcfa(it.amount) ?? ''].filter(Boolean).join(', ');
      const kindLabel = actionKindLabel(str(it.kind));
      const sub = [kindLabel !== str(it.title) ? kindLabel : '', meta].filter(Boolean).join(' · ');
      const url = appUrl + safeInternalPath(it.link);
      return `<tr>
        <td style="padding:11px 12px;${FONT}vertical-align:top;${i > 0 ? `border-top:1px solid ${TRAIT};` : ''}">
          <a href="${escapeHtml(url)}" target="_blank" style="${FONT}font-size:14px;font-weight:bold;color:${NUIT};text-decoration:none;">${escapeHtml(str(it.title) || actionKindLabel(str(it.kind)))}</a>
          <div style="${FONT}font-size:12px;color:${GRIS};margin-top:3px;">${escapeHtml(sub)}</div>
        </td>
        <td align="right" style="padding:11px 12px;${FONT}font-size:13px;font-weight:bold;color:${color};white-space:nowrap;vertical-align:top;${i > 0 ? `border-top:1px solid ${TRAIT};` : ''}">${escapeHtml(ageLabel(hours))}</td>
      </tr>`;
    })
    .join('');
  const more = count > items.length ? `<p style="margin:12px 0 0 0;${FONT}font-size:13px;color:${GRIS};">Et ${count - items.length} autre(s) dans l'application.</p>` : '';
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${TRAIT};border-radius:6px;">
      <tr><td style="padding:8px 12px;${FONT}font-size:12px;color:${GRIS};background-color:#FAFBFC;border-bottom:1px solid ${TRAIT};">Action</td>
          <td align="right" style="padding:8px 12px;${FONT}font-size:12px;color:${GRIS};background-color:#FAFBFC;border-bottom:1px solid ${TRAIT};">En attente depuis</td></tr>
      ${rowsHtml}
    </table>${more}`;
  const url = appUrl + '/actions';
  const textRows = items
    .map((it) => {
      const hours = typeof it.age_hours === 'number' ? it.age_hours : ageHoursFrom(it.created_at) ?? 0;
      const meta = [str(it.document_number), str(it.client), formatFcfa(it.amount) ?? ''].filter(Boolean).join(', ');
      return `- ${str(it.title)}${meta ? ` (${meta})` : ''}, en attente depuis ${ageLabel(hours)} : ${appUrl + safeInternalPath(it.link)}`;
    })
    .join('\n');
  return {
    subject,
    html: layout({
      preheader: subject,
      heading: 'Vos actions en attente',
      intro,
      body: table,
      buttonUrl: url,
      buttonLabel: 'Voir mes actions en attente',
      footerNote: 'Récapitulatif envoyé chaque matin tant que des actions vous attendent.',
    }),
    text: `Vos actions en attente\n\n${intro}\n\n${textRows}\n\nVoir mes actions : ${url}\n\n${TEXT_FOOTER}\n`,
  };
}

export function renderEmail(input: EmailInput, appUrl: string): RenderedEmail {
  switch (input.template) {
    case 'action':
      return renderAction(input, appUrl);
    case 'rappel':
      return renderRappel(input, appUrl);
    case 'recapitulatif':
      return renderRecapitulatif(input, appUrl);
    default:
      // Une demande de validation reste présentée comme telle même si un
      // agent a choisi un autre nom de modèle.
      return input.category === 'validation' ? renderAction(input, appUrl) : renderInfo(input, appUrl);
  }
}
