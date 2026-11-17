// Libellés partagés (navigateur, serveur et e-mails) des actions à valider et
// des notifications. Simples correspondances : aucun accès aux données.

export const ACTION_KIND_LABELS: Record<string, string> = {
  proforma_a_valider: 'Proforma à valider',
  commande_a_verifier: 'Bon de commande à vérifier',
  facture_a_valider: 'Facture à valider',
  facture_a_emettre: 'Facture à émettre',
  paiement_a_confirmer: 'Paiement à confirmer',
  echeance: 'Échéance de paiement',
  compte_a_creer: 'Demande de création de compte',
};

// Verbe court utilisé en tête du sujet des e-mails.
export const ACTION_KIND_VERBS: Record<string, string> = {
  proforma_a_valider: 'À valider',
  commande_a_verifier: 'À vérifier',
  facture_a_valider: 'À valider',
  facture_a_emettre: 'À émettre',
  paiement_a_confirmer: 'À confirmer',
  echeance: 'Échéance',
  compte_a_creer: 'À valider',
};

export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  ...ACTION_KIND_LABELS,
  rappel: 'Rappel',
  escalade: 'En attente depuis 48 h',
  demande_inscription: "Demande d'inscription",
};

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  devis: 'Facture proforma',
  proforma: 'Facture proforma',
  commande: 'Bon de commande',
  facture: 'Facture',
  compte: 'Demande de compte',
  echeance: 'Échéance',
  paiement: 'Paiement',
};

export function actionKindLabel(kind: string | null | undefined) {
  if (!kind) return 'Action';
  return ACTION_KIND_LABELS[kind] ?? kind.replace(/_/g, ' ');
}

export function notificationTypeLabel(type: string | null | undefined) {
  if (!type) return '';
  return NOTIFICATION_TYPE_LABELS[type] ?? '';
}

export function documentTypeLabel(type: string | null | undefined) {
  if (!type) return '';
  return DOCUMENT_TYPE_LABELS[type] ?? type;
}

// 8500000 -> "8 500 000 F CFA" (espaces normales, compatibles avec tous les
// clients mail).
export function formatFcfa(value: unknown): string | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}${String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} F CFA`;
}

// Ancienneté lisible : "3 h", "2 j 4 h".
export function formatAge(fromIso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} j ${rest} h` : `${days} j`;
}

// Chemin interne uniquement (jamais d'URL externe ni de "//domaine").
export function safeInternalPath(path: unknown, fallback = '/actions'): string {
  if (typeof path !== 'string') return fallback;
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return fallback;
  // Aucun caractère de contrôle, espace ou barre oblique inverse : le
  // navigateur les retire ou les convertit (« /\t/site.com » devient « //site.com »).
  if (/[\u0000-\u0020\u007f\\]/.test(path)) return fallback;
  try {
    const url = new URL(path, 'https://kf-auto-erp.invalid');
    if (url.origin !== 'https://kf-auto-erp.invalid') return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
