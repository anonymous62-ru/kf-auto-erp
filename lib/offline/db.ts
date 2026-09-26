// Base locale IndexedDB (Dexie.js) — coeur du mode hors-ligne.
//
// Principe : toute creation (client, document) est ecrite ICI en premier,
// avec un id local (uuid genere sur l'appareil). Une file de synchronisation
// (syncQueue implicite via les champs `status`) est ensuite videe des que le
// reseau revient, par lib/offline/sync.ts. Le numero officiel du document
// n'est JAMAIS genere hors-ligne (pour garantir zero doublon) : il est
// attribue par la fonction PostgreSQL atomique au moment de la synchro.
import Dexie, { type Table } from 'dexie';

export type SyncableStatus = 'pending' | 'syncing' | 'synced' | 'error';
export type DocumentType = 'proforma' | 'devis' | 'facture' | 'bon_livraison' | 'recu' | 'avoir';

// ---------- Cache local (lecture hors-ligne : recherche client/produit) ----------
export interface CachedClient {
  id: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  phone?: string;
  email?: string;
  address?: string;
  updatedAt: string;
}

export interface CachedProduct {
  id: string;
  designation: string;
  sku?: string;
  brand?: string;
  model?: string;
  description?: string;
  salePrice: number;
  taxRate: number;
  updatedAt: string;
}

// ---------- Donnees en attente de synchronisation ----------
export interface PendingClient {
  localId: string; // prefixe "local:" utilise comme reference tant que non synchronise
  organizationId: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  phone?: string;
  email?: string;
  address?: string;
  status: SyncableStatus;
  remoteId?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface PendingDocumentItem {
  productId?: string;
  designation: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  discountPercent: number;
}

export interface PendingDocument {
  localId: string;
  documentType: DocumentType;
  clientId: string; // id reel du client, OU "local:<uuid>" si le client est lui-meme en attente
  clientLabel: string; // libelle mis en cache pour affichage immediat, sans jointure
  items: PendingDocumentItem[];
  notes?: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  status: SyncableStatus;
  remoteId?: string;
  remoteDocumentNumber?: string;
  errorMessage?: string;
  createdAt: string;
}

// ---------- Profil courant mis en cache (permet de creer hors-ligne sans requete) ----------
export interface CachedProfile {
  key: 'profile';
  userId: string;
  organizationId: string;
  fullName: string;
}

class KfAutoDB extends Dexie {
  cachedClients!: Table<CachedClient, string>;
  cachedProducts!: Table<CachedProduct, string>;
  pendingClients!: Table<PendingClient, string>;
  pendingDocuments!: Table<PendingDocument, string>;
  meta!: Table<CachedProfile, string>;

  constructor() {
    super('kf-auto-erp');
    this.version(2).stores({
      cachedClients: 'id, updatedAt',
      cachedProducts: 'id, updatedAt',
      pendingClients: 'localId, status, createdAt',
      pendingDocuments: 'localId, status, createdAt, documentType',
      meta: 'key',
    });
  }
}

export const db = new KfAutoDB();

export function newLocalId() {
  return `local:${crypto.randomUUID()}`;
}

export function isLocalId(id: string) {
  return id.startsWith('local:');
}

// Nombre total d'elements en attente (utilise pour le badge de statut)
export async function countPending() {
  const [clients, documents] = await Promise.all([
    db.pendingClients.where('status').anyOf('pending', 'error').count(),
    db.pendingDocuments.where('status').anyOf('pending', 'error').count(),
  ]);
  return clients + documents;
}
