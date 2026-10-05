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
  // uuid genere sur l'appareil et utilise comme clients.id a l'insertion :
  // une nouvelle tentative apres une coupure reseau retrouve la ligne deja
  // creee au lieu d'inserer un doublon.
  serverId: string;
  status: SyncableStatus;
  remoteId?: string;
  errorMessage?: string;
  createdAt: string;
  // Debut de la derniere tentative de synchro : permet de reprendre un
  // element reste bloque en 'syncing' (onglet ferme en pleine synchro).
  lastAttemptAt?: string;
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
  // uuid genere sur l'appareil et utilise comme documents.id a l'insertion
  // (meme principe que PendingClient.serverId : zero doublon sur nouvelle tentative).
  serverId: string;
  // Numero officiel deja obtenu du serveur mais pas encore confirme par une
  // insertion reussie : reutilise a la tentative suivante pour ne pas
  // consommer un nouveau numero a chaque echec reseau.
  reservedDocumentNumber?: string;
  status: SyncableStatus;
  remoteId?: string;
  remoteDocumentNumber?: string;
  errorMessage?: string;
  createdAt: string;
  lastAttemptAt?: string;
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
    // Version 3 : ajout de serverId (uuid stable cote serveur) sur les
    // elements en attente. Schema d'index inchange ; l'upgrade remplit
    // serverId pour les elements deja en file, sans rien supprimer. On
    // reprend l'uuid contenu dans le localId ("local:<uuid>") pour rester
    // deterministe.
    this.version(3)
      .stores({
        cachedClients: 'id, updatedAt',
        cachedProducts: 'id, updatedAt',
        pendingClients: 'localId, status, createdAt',
        pendingDocuments: 'localId, status, createdAt, documentType',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('pendingClients')
          .toCollection()
          .modify((record: Partial<PendingClient> & { localId: string }) => {
            if (!record.serverId) record.serverId = serverIdFromLocalId(record.localId);
          });
        await tx
          .table('pendingDocuments')
          .toCollection()
          .modify((record: Partial<PendingDocument> & { localId: string }) => {
            if (!record.serverId) record.serverId = serverIdFromLocalId(record.localId);
          });
      });
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Extrait l'uuid d'un localId "local:<uuid>" ; a defaut, en genere un neuf.
export function serverIdFromLocalId(localId: string) {
  const candidate = localId.startsWith('local:') ? localId.slice('local:'.length) : localId;
  return UUID_RE.test(candidate) ? candidate : crypto.randomUUID();
}

export const db = new KfAutoDB();

// Accepte un uuid deja genere (chemin en ligne qui bascule hors-ligne) pour
// que localId et serverId portent le meme uuid.
export function newLocalId(uuid: string = crypto.randomUUID()) {
  return `local:${uuid}`;
}

export function isLocalId(id: string) {
  return id.startsWith('local:');
}

// Nombre total d'elements en attente (utilise pour le badge de statut).
// 'syncing' est compte aussi : un element bloque dans cet etat (onglet ferme
// en pleine synchro) n'est pas encore sur le serveur.
export async function countPending() {
  const [clients, documents] = await Promise.all([
    db.pendingClients.where('status').anyOf('pending', 'syncing', 'error').count(),
    db.pendingDocuments.where('status').anyOf('pending', 'syncing', 'error').count(),
  ]);
  return clients + documents;
}
