// Pièces justificatives d'un client (migration 0046). Fichier sans
// 'use server' : importable côté serveur comme côté navigateur.
//
// Une pièce manquante ne bloque jamais une vente : on affiche seulement un
// avertissement (fiche client, liste, vérification de conformité ADV).

export const CLIENT_DOCUMENT_KINDS = ['cni', 'nationalite', 'acte_naissance', 'coe', 'carte_unique_creation', 'autre'] as const;
export type ClientDocumentKind = (typeof CLIENT_DOCUMENT_KINDS)[number];

export const CLIENT_DOCUMENT_LABELS: Record<ClientDocumentKind, string> = {
  cni: "Carte d'identité",
  nationalite: 'Certificat de nationalité',
  acte_naissance: 'Acte de naissance',
  coe: "Carte d'opérateur économique (COE)",
  carte_unique_creation: "Carte unique de création d'entreprise",
  autre: 'Autre pièce',
};

export const COMPANY_DOCUMENT_LABEL = "Carte d'opérateur économique (COE) ou carte unique de création d'entreprise";

// Pièces proposées à l'envoi selon le type de client (la dernière est libre).
export function documentKindsFor(clientType: string | null): ClientDocumentKind[] {
  return clientType === 'entreprise'
    ? ['coe', 'carte_unique_creation', 'autre']
    : ['cni', 'nationalite', 'acte_naissance', 'autre'];
}

export function isClientDocumentKind(value: string): value is ClientDocumentKind {
  return (CLIENT_DOCUMENT_KINDS as readonly string[]).includes(value);
}

export function clientDocumentLabel(kind: string): string {
  return isClientDocumentKind(kind) ? CLIENT_DOCUMENT_LABELS[kind] : kind;
}

/**
 * Pièces requises encore absentes.
 * Particulier : carte d'identité, certificat de nationalité, acte de naissance.
 * Entreprise : COE ou carte unique de création (l'une des deux suffit) ; si
 * aucune n'est fournie, une seule entrée regroupe les deux.
 */
export function missingClientDocuments(clientType: string | null, kinds: string[]): { kind: string; label: string }[] {
  const have = new Set(kinds);
  if (clientType === 'entreprise') {
    return have.has('coe') || have.has('carte_unique_creation') ? [] : [{ kind: 'coe', label: COMPANY_DOCUMENT_LABEL }];
  }
  return (['cni', 'nationalite', 'acte_naissance'] as const)
    .filter((k) => !have.has(k))
    .map((k) => ({ kind: k, label: CLIENT_DOCUMENT_LABELS[k] }));
}

// Contrôles d'envoi (identiques à la base et au bucket client-documents).
export const CLIENT_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const CLIENT_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export const CLIENT_DOCUMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/jpeg,image/png,image/webp,image/heic';

const EXTENSION_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

// Certains téléphones envoient un type vide pour le HEIC : on se replie sur l'extension.
export function clientDocumentMime(fileName: string, declared: string): string | null {
  const type = (declared || '').toLowerCase();
  if ((CLIENT_DOCUMENT_MIME_TYPES as readonly string[]).includes(type)) return type;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MIME[ext] ?? null;
}

export function validateClientDocumentFile(fileName: string, declared: string, size: number): string | null {
  if (!clientDocumentMime(fileName, declared)) return 'Format refusé : PDF, JPEG, PNG, WEBP ou HEIC uniquement.';
  if (size <= 0) return 'Le fichier est vide.';
  if (size > CLIENT_DOCUMENT_MAX_BYTES) return 'Fichier trop lourd : 10 Mo au maximum.';
  return null;
}

// Nom de fichier sûr pour le chemin de stockage (sans accents ni espaces).
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+/, '')
    .slice(-80);
  return cleaned || 'piece';
}

// Rôles qui suppriment toujours une pièce (sinon l'auteur, dans les 24 h).
export const CLIENT_DOCUMENT_DELETE_ROLES = ['super_admin', 'administrateur', 'manager', 'admin_ventes'];
// Rôles qui ajoutent des pièces à tout client (sinon le commercial attitré).
export const CLIENT_DOCUMENT_WRITE_ROLES = ['super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes'];
