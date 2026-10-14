// Règles de sécurité des factures (direction, 10/10/2026), partagées entre
// l'interface et les actions serveur. La base applique les mêmes règles
// (migration 0037) : l'interface ne fait que les rendre visibles.

// Préparent une facture en brouillon (véhicules et atelier).
export const INVOICE_EDITOR_ROLES = [
  'super_admin',
  'administrateur',
  'manager',
  'admin_ventes',
  'comptable',
  'receptionniste_sav',
  'chef_atelier',
];

// Établissent un avoir ou annulent une facture : administration des ventes
// et direction, jamais un commercial.
export const CREDIT_NOTE_ROLES = ['super_admin', 'administrateur', 'manager', 'admin_ventes'];

export function isInvoiceLike(documentType: string) {
  return documentType === 'facture' || documentType === 'avoir';
}

// Règle de la direction (12/10/2026) : une facture reste modifiable par
// l'administration des ventes tant qu'aucun paiement n'est enregistré. Dès le
// premier versement, elle est verrouillée pour tout le monde. Un avoir est
// toujours figé une fois créé.
export function isLockedInvoice(documentType: string, status: string, amountPaid: number) {
  if (documentType === 'avoir') return status !== 'brouillon';
  if (documentType !== 'facture') return false;
  return ['paye_partiel', 'paye', 'annule'].includes(status) || amountPaid > 0;
}

export const LOCKED_INVOICE_MESSAGE =
  'Un paiement est enregistré sur cette facture : elle ne peut plus être modifiée. Toute correction passe par un avoir.';

// Motif de refus d'une modification, ou null si elle est permise.
export function invoiceEditBlockReason(documentType: string, status: string, role: string, amountPaid = 0): string | null {
  if (!isInvoiceLike(documentType)) return null;
  if (documentType === 'avoir') return 'Un avoir ne se modifie pas.';
  if (status === 'annule') return 'Cette facture est annulée.';
  if (isLockedInvoice(documentType, status, amountPaid)) return LOCKED_INVOICE_MESSAGE;
  if (!INVOICE_EDITOR_ROLES.includes(role)) return "Seule l'administration des ventes peut modifier une facture.";
  return null;
}
