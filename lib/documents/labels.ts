// Libellés d'affichage des types et statuts de documents (interface web).
// Fichier sans 'use server' : utilisable côté client comme côté serveur.

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  proforma: 'Proforma',
  devis: 'Devis',
  facture: 'Facture',
  bon_livraison: 'Bon de livraison',
  recu: 'Reçu',
  avoir: 'Avoir',
};

export const DOCUMENT_STATUS: Record<string, { label: string; badge: string }> = {
  brouillon: { label: 'Brouillon', badge: 'badge-gray' },
  envoye: { label: 'Envoyé', badge: 'badge-navy' },
  accepte: { label: 'Accepté', badge: 'badge-green' },
  refuse: { label: 'Refusé', badge: 'badge-red' },
  paye_partiel: { label: 'Paiement partiel', badge: 'badge-orange' },
  paye: { label: 'Payé', badge: 'badge-green' },
  annule: { label: 'Annulé', badge: 'badge-gray' },
};

export function documentStatus(status: string) {
  return DOCUMENT_STATUS[status] ?? { label: status, badge: 'badge-gray' };
}

export function clientDisplayName(
  client: { company_name?: string | null; first_name?: string | null; last_name?: string | null } | null | undefined
) {
  if (!client) return 'Client inconnu';
  const person = `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim();
  return client.company_name || person || 'Client sans nom';
}
