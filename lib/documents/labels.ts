// Libellés d'affichage des types et statuts de documents (interface web,
// PDF). Fichier sans 'use server' : utilisable côté client comme côté
// serveur. Toutes les pages doivent passer par ces tables plutôt que de
// redéfinir leurs propres libellés.
//
// Circuit de vente (direction, 09/10/2026) :
//   Facture proforma (type interne "devis", numéros FP-) -> Commande (CMD-)
//   -> Facture (FAC-, établie uniquement par l'administration des ventes).
// Le type "proforma" (PF-) est l'ancien modèle, conservé pour l'historique.

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  devis: 'Facture proforma',
  commande: 'Commande',
  facture: 'Facture',
  proforma: 'Proforma (ancien modèle)',
  bon_livraison: 'Bon de livraison',
  recu: 'Reçu',
  avoir: 'Avoir',
};

// Titre imprimé en tête du PDF.
export const DOCUMENT_PRINT_TITLES: Record<string, string> = {
  devis: 'FACTURE PROFORMA',
  commande: 'BON DE COMMANDE',
  facture: 'FACTURE',
  proforma: 'FACTURE PROFORMA',
  bon_livraison: 'BON DE LIVRAISON',
  recu: 'REÇU',
  avoir: 'AVOIR',
};

// Article défini ("la facture proforma", "la commande"...) pour les boutons.
export const DOCUMENT_TYPE_WITH_ARTICLE: Record<string, string> = {
  devis: 'la facture proforma',
  commande: 'la commande',
  facture: 'la facture',
  proforma: 'la proforma',
  bon_livraison: 'le bon de livraison',
  recu: 'le reçu',
  avoir: "l'avoir",
};

export function documentTypeLabel(type: string) {
  return DOCUMENT_TYPE_LABELS[type] ?? type;
}

export const DOCUMENT_STATUS: Record<string, { label: string; badge: string }> = {
  brouillon: { label: 'Brouillon', badge: 'badge-gray' },
  envoye: { label: 'Envoyé', badge: 'badge-blue' },
  accepte: { label: 'Accepté', badge: 'badge-indigo' },
  refuse: { label: 'Refusé', badge: 'badge-red' },
  paye_partiel: { label: 'Acompte reçu', badge: 'badge-amber' },
  paye: { label: 'Payé', badge: 'badge-green' },
  annule: { label: 'Annulé', badge: 'badge-gray' },
};

// Badge d'un document, avec le même vocabulaire partout (direction, 10/10) :
// Brouillon, Envoyé, Commande, Facturé, Payé, En retard, Avoir.
//   - une proforma acceptée est passée en « Commande » ;
//   - une commande : « À facturer » puis « Facturé » ;
//   - une facture émise non soldée : « Facturé », ou « En retard » après
//     l'échéance ;
//   - un avoir : « Avoir ».
export function documentStatus(
  status: string,
  type?: string,
  extra?: { dueDate?: string | null; balance?: number | null }
) {
  if (type === 'avoir') {
    return status === 'annule' ? { label: 'Avoir annulé', badge: 'badge-gray' } : { label: 'Avoir', badge: 'badge-violet' };
  }
  if (status === 'annule') {
    return { label: type === 'facture' || type === 'commande' ? 'Annulée' : 'Annulé', badge: 'badge-gray' };
  }
  if (status === 'paye') return { label: 'Payé', badge: 'badge-green' };
  const today = new Date().toISOString().slice(0, 10);
  const late =
    type === 'facture' &&
    !!extra?.dueDate &&
    extra.dueDate < today &&
    Number(extra.balance ?? 0) > 0 &&
    ['envoye', 'paye_partiel'].includes(status);
  if (late) return { label: 'En retard', badge: 'badge-red' };
  if (status === 'accepte' && (type === 'devis' || type === 'proforma')) {
    return { label: 'Commande', badge: 'badge-indigo' };
  }
  if (type === 'commande') {
    if (status === 'accepte') return { label: 'Facturé', badge: 'badge-navy' };
    if (status === 'brouillon') return { label: 'À facturer', badge: 'badge-amber' };
  }
  if (type === 'facture' && status === 'envoye') return { label: 'Facturé', badge: 'badge-navy' };
  return DOCUMENT_STATUS[status] ?? { label: status, badge: 'badge-gray' };
}

export function clientDisplayName(
  client: { company_name?: string | null; first_name?: string | null; last_name?: string | null } | null | undefined
) {
  if (!client) return 'Client inconnu';
  const person = `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim();
  return client.company_name || person || 'Client sans nom';
}

export const CLIENT_STATUS: Record<string, { label: string; badge: string }> = {
  prospect: { label: 'Prospect', badge: 'badge-orange' },
  client: { label: 'Client', badge: 'badge-green' },
};

export function clientStatus(status: string | null | undefined) {
  return CLIENT_STATUS[status ?? 'prospect'] ?? CLIENT_STATUS.prospect;
}
