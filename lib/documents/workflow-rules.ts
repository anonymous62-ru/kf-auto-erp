// Règles du circuit de vente (réunion de direction du 16/11/2026).
// Fichier partagé, sans 'use server' : importable côté client et serveur.
//
// Le statut de circuit (documents.workflow_status) est distinct du statut de
// paiement existant (documents.status : brouillon, envoye, paye_partiel...).
// La facture proforma a le type interne « devis » (numéros FP-).

export type ProformaStep = 'brouillon' | 'en_attente_validation' | 'validee' | 'refusee' | 'envoyee' | 'acceptee';
export type CommandeStep = 'a_verifier' | 'conforme' | 'non_conforme' | 'facture_en_attente_validation' | 'facture';
export type FactureStep = 'en_preparation' | 'en_attente_validation' | 'validee' | 'refusee' | 'emise';
export type WorkflowStep = ProformaStep | CommandeStep | FactureStep;

export const DIRECTION_ROLES = ['super_admin', 'administrateur', 'manager'] as const;
// Précision du 17/11 : tous les rôles non commerciaux valident (proformas,
// bons de commande, factures). Seuls les commerciaux (commercial,
// vendeur_showroom, responsable_showroom) ne valident rien.
export const VALIDATOR_ROLES = ['super_admin', 'administrateur', 'manager', 'responsable_commercial', 'admin_ventes', 'comptable'] as const;
export const PROFORMA_VALIDATOR_ROLES = VALIDATOR_ROLES;
export const ADV_ROLES = VALIDATOR_ROLES;
export const INVOICE_VALIDATOR_ROLES = VALIDATOR_ROLES;

export function isProformaType(type: string | null | undefined) {
  return type === 'devis' || type === 'proforma';
}

const LABELS: Record<string, Record<string, { label: string; badge: string }>> = {
  proforma: {
    brouillon: { label: 'Brouillon', badge: 'badge-gray' },
    en_attente_validation: { label: 'En attente de validation', badge: 'badge-amber' },
    validee: { label: 'Validée', badge: 'badge-blue' },
    refusee: { label: 'Refusée', badge: 'badge-red' },
    envoyee: { label: 'Envoyée', badge: 'badge-navy' },
    acceptee: { label: 'Acceptée par le client', badge: 'badge-green' },
  },
  commande: {
    a_verifier: { label: 'À vérifier', badge: 'badge-amber' },
    conforme: { label: 'Conforme', badge: 'badge-blue' },
    non_conforme: { label: 'Non conforme', badge: 'badge-red' },
    facture_en_attente_validation: { label: 'Facture en attente de validation', badge: 'badge-amber' },
    facture: { label: 'Facturé', badge: 'badge-green' },
  },
  facture: {
    en_preparation: { label: 'En préparation', badge: 'badge-gray' },
    en_attente_validation: { label: 'En attente de validation direction', badge: 'badge-amber' },
    validee: { label: 'Validée par la direction', badge: 'badge-blue' },
    refusee: { label: 'Refusée', badge: 'badge-red' },
    emise: { label: 'Émise', badge: 'badge-green' },
  },
};

export function workflowLabel(type: string | null | undefined, step: string | null | undefined) {
  if (!step) return null;
  const family = isProformaType(type) ? 'proforma' : type === 'commande' ? 'commande' : type === 'facture' ? 'facture' : null;
  if (!family) return null;
  return LABELS[family][step] ?? { label: step, badge: 'badge-gray' };
}

// Le document peut-il être téléchargé (PDF) ou envoyé au client ?
// - proforma : seulement après validation du N+1 ;
// - bon de commande : seulement une fois déclaré conforme par l'ADV ;
// - facture : seulement une fois émise.
// Les valideurs (N+1, direction) et l'ADV peuvent prévisualiser le PDF pour
// décider, mais pas l'envoyer (canSendDocument).
export function canSendDocument(type: string | null | undefined, step: string | null | undefined) {
  if (isProformaType(type)) return step === 'validee' || step === 'envoyee' || step === 'acceptee';
  if (type === 'commande') return step === 'conforme' || step === 'facture_en_attente_validation' || step === 'facture';
  if (type === 'facture') return step == null || step === 'emise';
  return true;
}

export function canDownloadDocument(type: string | null | undefined, step: string | null | undefined, role: string | null | undefined) {
  if (canSendDocument(type, step)) return true;
  const r = role ?? '';
  if (isProformaType(type)) return (PROFORMA_VALIDATOR_ROLES as readonly string[]).includes(r);
  if (type === 'commande' || type === 'facture') {
    return (ADV_ROLES as readonly string[]).includes(r) || (DIRECTION_ROLES as readonly string[]).includes(r);
  }
  return false;
}

export function sendBlockedReason(type: string | null | undefined, step: string | null | undefined) {
  if (canSendDocument(type, step)) return null;
  if (isProformaType(type)) return 'La proforma doit être validée par le responsable commercial avant d\'être envoyée ou téléchargée.';
  if (type === 'commande') return 'Le bon de commande doit être déclaré conforme par l\'administration des ventes avant d\'être envoyé.';
  if (type === 'facture') return 'La facture doit être validée par la direction puis émise avant d\'être envoyée.';
  return null;
}

// ---------- Circuit de vente (étapes 1 et 2, migration 0044) ----------

// La « facture en attente de validation » vit sur le bon de commande (aucun
// numéro FAC n'est pris avant l'émission). Une fois validée par la direction,
// le bon de commande reste à l'étape facture_en_attente_validation avec
// validated_at renseigné : l'ADV peut alors émettre.
export function commandeInvoiceValidated(step: string | null | undefined, validatedAt: string | null | undefined) {
  return step === 'facture_en_attente_validation' && !!validatedAt;
}

// Libellé affiché, en tenant compte de la validation direction du bon de commande.
export function workflowDisplay(
  type: string | null | undefined,
  step: string | null | undefined,
  validatedAt?: string | null
) {
  if (type === 'commande' && commandeInvoiceValidated(step, validatedAt)) {
    return { label: 'Facture validée, à émettre', badge: 'badge-blue' };
  }
  return workflowLabel(type, step);
}

export function isRole(role: string | null | undefined, roles: readonly string[]) {
  return !!role && roles.includes(role);
}

// Filtres « étape » de la liste des documents.
export const WORKFLOW_FILTERS: { key: string; label: string; type: string[]; step: string; validated?: boolean }[] = [
  { key: 'proforma_a_valider', label: 'Proformas à valider', type: ['devis', 'proforma'], step: 'en_attente_validation' },
  { key: 'proforma_refusee', label: 'Proformas refusées', type: ['devis', 'proforma'], step: 'refusee' },
  { key: 'commande_a_verifier', label: 'Bons de commande à vérifier', type: ['commande'], step: 'a_verifier' },
  { key: 'commande_non_conforme', label: 'Bons de commande non conformes', type: ['commande'], step: 'non_conforme' },
  { key: 'commande_conforme', label: 'Bons de commande à facturer', type: ['commande'], step: 'conforme' },
  { key: 'facture_a_valider', label: 'Factures à valider', type: ['commande'], step: 'facture_en_attente_validation', validated: false },
  { key: 'facture_a_emettre', label: 'Factures à émettre', type: ['commande'], step: 'facture_en_attente_validation', validated: true },
];
