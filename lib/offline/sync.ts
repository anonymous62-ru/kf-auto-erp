// Moteur de synchronisation : vide la file d'attente locale des que le
// reseau est disponible. Ordre strict : clients en attente d'abord (les
// documents peuvent en dependre), puis documents. Le numero officiel du
// document est attribue ICI, au moment de la synchro, via la fonction
// PostgreSQL atomique — jamais avant, pour garantir zero doublon meme si
// plusieurs commerciaux synchronisent en meme temps.
//
// Idempotence : chaque element en attente porte un serverId (uuid genere sur
// l'appareil) utilise comme id de la ligne inseree. Si une tentative echoue
// apres que le serveur a deja enregistre la ligne (coupure reseau pendant la
// reponse), la tentative suivante retrouve cette ligne par son id et termine
// le travail au lieu de creer un doublon avec un nouveau numero.
import { createClient } from '@/lib/supabase/client';
import { db, isLocalId, type PendingClient, type PendingDocument } from '@/lib/offline/db';
import { getCachedProfile } from '@/lib/offline/profile';
import { applyFactureStockDeduction } from '@/lib/documents/stock-deduction';

export interface SyncResult {
  clientsSynced: number;
  documentsSynced: number;
  errors: string[];
}

// Au-dela de ce delai, un element reste en 'syncing' est considere comme
// abandonne (onglet ferme, telephone mis en veille en pleine synchro) et
// repris par la synchro suivante.
const STALE_SYNCING_MS = 2 * 60 * 1000;

let syncInFlight: Promise<SyncResult> | null = null;

function emptyResult(): SyncResult {
  return { clientsSynced: 0, documentsSynced: 0, errors: [] };
}

export function runSync(): Promise<SyncResult> {
  // evite deux synchros en parallele dans le meme onglet (ex: event 'online' + bouton manuel)
  if (syncInFlight) return syncInFlight;
  syncInFlight = runWithCrossTabLock().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

// Le verrou en memoire ne protege qu'un onglet. Avec plusieurs onglets ouverts
// (cas frequent sur telephone), on utilise le Web Locks API, partage par tous
// les onglets de la meme origine : si un autre onglet synchronise deja, on
// n'attend pas, on rend simplement un resultat vide. Le verrou est libere
// automatiquement par le navigateur si l'onglet est ferme.
function runWithCrossTabLock(): Promise<SyncResult> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== 'function') return doSync();
  return locks.request('kf-sync', { ifAvailable: true }, async (lock) => {
    if (!lock) return emptyResult();
    return doSync();
  }) as Promise<SyncResult>;
}

// Les erreurs Supabase (PostgrestError) ne sont pas toujours des instances
// d'Error : on lit leur message et leur code sans supposer le type.
function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return String(e);
}

function isUniqueViolation(e: unknown) {
  return !!e && typeof e === 'object' && (e as { code?: unknown }).code === '23505';
}

function isStaleSyncing(item: { status: string; lastAttemptAt?: string }, now: number) {
  if (item.status !== 'syncing') return false;
  // sans horodatage (element anterieur a cette version) : forcement abandonne
  if (!item.lastAttemptAt) return true;
  return now - new Date(item.lastAttemptAt).getTime() > STALE_SYNCING_MS;
}

// Elements a traiter : 'pending', 'error', et 'syncing' abandonnes.
function selectRunnable<T extends { status: string; lastAttemptAt?: string }>(items: T[]) {
  const now = Date.now();
  return items.filter((item) => item.status !== 'syncing' || isStaleSyncing(item, now));
}

async function doSync(): Promise<SyncResult> {
  const result = emptyResult();
  if (!navigator.onLine) return result;

  const profile = await getCachedProfile();
  if (!profile) return result;

  const supabase = createClient();

  // ---------- 1. Clients en attente ----------
  const pendingClients: PendingClient[] = selectRunnable(
    await db.pendingClients.where('status').anyOf('pending', 'error', 'syncing').sortBy('createdAt')
  );
  for (const pc of pendingClients) {
    try {
      await db.pendingClients.update(pc.localId, { status: 'syncing', lastAttemptAt: new Date().toISOString() });

      // Le client a peut-etre deja ete cree lors d'une tentative precedente
      // (insertion reussie mais reponse perdue) : on verifie avant d'inserer.
      if (!(await clientExists(supabase, pc.serverId))) {
        const { error } = await supabase.from('clients').insert({
          id: pc.serverId,
          organization_id: pc.organizationId,
          assigned_to: profile.userId,
          created_by: profile.userId,
          first_name: pc.firstName,
          last_name: pc.lastName,
          company_name: pc.companyName,
          phone: pc.phone,
          email: pc.email || null,
          address: pc.address || null,
        });
        if (error) {
          // 23505 : la ligne existe deja (course avec une autre tentative). On
          // ne le traite comme un succes que si c'est bien NOTRE id qui existe ;
          // sinon c'est une autre contrainte d'unicite, a remonter telle quelle.
          if (!isUniqueViolation(error) || !(await clientExists(supabase, pc.serverId))) throw error;
        }
      }

      await db.pendingClients.update(pc.localId, { status: 'synced', remoteId: pc.serverId, errorMessage: undefined });
      await db.cachedClients.put({
        id: pc.serverId,
        firstName: pc.firstName,
        lastName: pc.lastName,
        companyName: pc.companyName,
        phone: pc.phone,
        email: pc.email,
        address: pc.address,
        updatedAt: new Date().toISOString(),
      });
      result.clientsSynced += 1;
    } catch (e) {
      const message = errorMessage(e);
      await db.pendingClients.update(pc.localId, { status: 'error', errorMessage: message });
      result.errors.push(`Client ${pc.companyName || pc.lastName || pc.phone} : ${message}`);
    }
  }

  // ---------- 2. Documents en attente ----------
  const pendingDocuments: PendingDocument[] = selectRunnable(
    await db.pendingDocuments.where('status').anyOf('pending', 'error', 'syncing').sortBy('createdAt')
  );
  for (const pd of pendingDocuments) {
    try {
      // resout le client si c'etait lui-meme en attente de synchro
      let clientId = pd.clientId;
      if (isLocalId(clientId)) {
        const relatedClient = await db.pendingClients.get(clientId);
        if (!relatedClient || relatedClient.status !== 'synced' || !relatedClient.remoteId) {
          // Le client n'est pas encore synchronise : le document reste en
          // attente (rien n'est perdu), mais on explique pourquoi pour que le
          // commercial ne croie pas a un blocage silencieux.
          const waitingMessage = !relatedClient
            ? 'Client introuvable sur cet appareil : le document ne peut pas être envoyé.'
            : relatedClient.status === 'error'
              ? `En attente du client ${pd.clientLabel} : sa synchronisation a échoué (${relatedClient.errorMessage ?? 'erreur inconnue'}).`
              : `En attente de la synchronisation du client ${pd.clientLabel}.`;
          await db.pendingDocuments.update(pd.localId, { status: 'pending', errorMessage: waitingMessage });
          continue;
        }
        clientId = relatedClient.remoteId;
      }

      await db.pendingDocuments.update(pd.localId, { status: 'syncing', lastAttemptAt: new Date().toISOString() });

      // 1) Le document existe-t-il deja sur le serveur (tentative precedente
      //    interrompue apres l'insertion) ? Si oui on reprend son numero, sans
      //    en demander un nouveau.
      let documentNumber = await findDocumentNumber(supabase, pd.serverId);

      if (documentNumber === undefined) {
        // 2) Numero officiel : on reutilise celui deja reserve lors d'une
        //    tentative precedente qui n'a pas abouti, sinon on en demande un
        //    et on le memorise AVANT l'insertion. Ainsi une coupure entre la
        //    numerotation et l'insertion ne consomme pas plusieurs numeros.
        let number = pd.reservedDocumentNumber;
        if (!number) {
          const year = new Date().getFullYear();
          const { data, error: numberError } = await supabase.rpc('get_next_document_number', {
            p_organization_id: profile.organizationId,
            p_document_type: pd.documentType,
            p_year: year,
          });
          if (numberError) throw numberError;
          number = data as string;
          await db.pendingDocuments.update(pd.localId, { reservedDocumentNumber: number });
        }

        const { error: documentError } = await supabase.from('documents').insert({
          id: pd.serverId,
          organization_id: profile.organizationId,
          document_type: pd.documentType,
          document_number: number,
          status: 'brouillon',
          client_id: clientId,
          commercial_id: profile.userId,
          issue_date: pd.createdAt.slice(0, 10),
          // Échéance à un mois de la date de création réelle (hors-ligne),
          // pas de la date de synchronisation, pour rester cohérent avec ce
          // que le commercial a effectivement promis au client sur le terrain.
          due_date: (() => {
            const d = new Date(pd.createdAt);
            d.setMonth(d.getMonth() + 1);
            return d.toISOString().slice(0, 10);
          })(),
          subtotal: pd.subtotal,
          tax_amount: pd.taxAmount,
          total_amount: pd.totalAmount,
          notes: pd.notes,
        });
        if (documentError) {
          if (!isUniqueViolation(documentError)) throw documentError;
          // 23505 : soit notre id existe deja (insertion concurrente reussie),
          // soit le numero reserve a deja ete utilise ailleurs. Dans le second
          // cas on oublie ce numero pour en demander un neuf a la prochaine
          // tentative.
          const existingNumber = await findDocumentNumber(supabase, pd.serverId);
          if (existingNumber === undefined) {
            await db.pendingDocuments.update(pd.localId, { reservedDocumentNumber: undefined });
            throw documentError;
          }
          documentNumber = existingNumber;
        } else {
          documentNumber = number;
        }
      }

      // 3) Lignes du document : insertion en une seule requete (atomique),
      //    donc soit toutes presentes, soit aucune. On ne les insere que si
      //    aucune n'existe encore, pour ne pas les doubler sur reprise.
      const { count: itemCount, error: countError } = await supabase
        .from('document_items')
        .select('id', { count: 'exact', head: true })
        .eq('document_id', pd.serverId);
      if (countError) throw countError;

      if (!itemCount) {
        const itemRows = pd.items.map((item, index) => ({
          document_id: pd.serverId,
          product_id: item.productId ?? null,
          designation: item.designation,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          tax_rate: item.taxRate,
          discount_percent: item.discountPercent ?? 0,
          position: index,
        }));
        const { error: itemsError } = await supabase.from('document_items').insert(itemRows);
        if (itemsError) throw itemsError;
      }

      // Règle du DG (04/10) : une facture retire automatiquement du stock,
      // même lorsqu'elle a été créée hors-ligne puis synchronisée ensuite.
      // apply_facture_stock ne s'applique qu'une fois par facture : sans
      // risque de la rappeler lors d'une reprise.
      if (pd.documentType === 'facture') {
        await applyFactureStockDeduction(supabase, {
          organizationId: profile.organizationId,
          documentId: pd.serverId,
          documentNumber: documentNumber ?? '',
          items: pd.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          performedBy: profile.userId,
        });
      }

      await db.pendingDocuments.update(pd.localId, {
        status: 'synced',
        remoteId: pd.serverId,
        remoteDocumentNumber: documentNumber ?? undefined,
        errorMessage: undefined,
      });
      result.documentsSynced += 1;
    } catch (e) {
      const message = errorMessage(e);
      await db.pendingDocuments.update(pd.localId, { status: 'error', errorMessage: message });
      result.errors.push(`Document ${pd.clientLabel} : ${message}`);
    }
  }

  return result;
}

type SupabaseBrowserClient = ReturnType<typeof createClient>;

// RLS : un commercial peut toujours relire les clients qui lui sont assignes
// (assigned_to = auth.uid()), donc une ligne qu'il a creee est visible ici.
async function clientExists(supabase: SupabaseBrowserClient, id: string) {
  const { data, error } = await supabase.from('clients').select('id').eq('id', id).maybeSingle();
  if (error) throw error;
  return !!data;
}

// Renvoie undefined si le document n'existe pas encore, sinon son numero
// (null possible en theorie si la colonne est vide). Meme garantie RLS :
// commercial_id = auth.uid().
async function findDocumentNumber(supabase: SupabaseBrowserClient, id: string): Promise<string | null | undefined> {
  const { data, error } = await supabase.from('documents').select('id, document_number').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return undefined;
  return (data as { document_number: string | null }).document_number;
}
