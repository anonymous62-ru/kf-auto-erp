// Moteur de synchronisation : vide la file d'attente locale des que le
// reseau est disponible. Ordre strict : clients en attente d'abord (les
// documents peuvent en dependre), puis documents. Le numero officiel du
// document est attribue ICI, au moment de la synchro, via la fonction
// PostgreSQL atomique — jamais avant, pour garantir zero doublon meme si
// plusieurs commerciaux synchronisent en meme temps.
import { createClient } from '@/lib/supabase/client';
import { db, isLocalId } from '@/lib/offline/db';
import { getCachedProfile } from '@/lib/offline/profile';

export interface SyncResult {
  clientsSynced: number;
  documentsSynced: number;
  errors: string[];
}

let syncInFlight: Promise<SyncResult> | null = null;

export function runSync(): Promise<SyncResult> {
  // evite deux synchros en parallele (ex: event 'online' + bouton manuel)
  if (syncInFlight) return syncInFlight;
  syncInFlight = doSync().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function doSync(): Promise<SyncResult> {
  const result: SyncResult = { clientsSynced: 0, documentsSynced: 0, errors: [] };
  if (!navigator.onLine) return result;

  const profile = await getCachedProfile();
  if (!profile) return result;

  const supabase = createClient();

  // ---------- 1. Clients en attente ----------
  const pendingClients = await db.pendingClients.where('status').anyOf('pending', 'error').sortBy('createdAt');
  for (const pc of pendingClients) {
    try {
      await db.pendingClients.update(pc.localId, { status: 'syncing' });
      const { data, error } = await supabase
        .from('clients')
        .insert({
          organization_id: pc.organizationId,
          assigned_to: profile.userId,
          created_by: profile.userId,
          first_name: pc.firstName,
          last_name: pc.lastName,
          company_name: pc.companyName,
          phone: pc.phone,
          email: pc.email || null,
          address: pc.address || null,
        })
        .select('id')
        .single();
      if (error) throw error;

      await db.pendingClients.update(pc.localId, { status: 'synced', remoteId: data.id });
      await db.cachedClients.put({
        id: data.id,
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
      const message = e instanceof Error ? e.message : String(e);
      await db.pendingClients.update(pc.localId, { status: 'error', errorMessage: message });
      result.errors.push(`Client ${pc.companyName || pc.lastName || pc.phone} : ${message}`);
    }
  }

  // ---------- 2. Documents en attente ----------
  const pendingDocuments = await db.pendingDocuments.where('status').anyOf('pending', 'error').sortBy('createdAt');
  for (const pd of pendingDocuments) {
    try {
      // resout le client si c'etait lui-meme en attente de synchro
      let clientId = pd.clientId;
      if (isLocalId(clientId)) {
        const relatedClient = await db.pendingClients.get(clientId);
        if (!relatedClient || relatedClient.status !== 'synced' || !relatedClient.remoteId) {
          // le client n'est pas encore synchronise (ou a echoue) : on retente plus tard
          continue;
        }
        clientId = relatedClient.remoteId;
      }

      await db.pendingDocuments.update(pd.localId, { status: 'syncing' });

      const year = new Date().getFullYear();
      const { data: documentNumber, error: numberError } = await supabase.rpc('get_next_document_number', {
        p_organization_id: profile.organizationId,
        p_document_type: pd.documentType,
        p_year: year,
      });
      if (numberError) throw numberError;

      const { data: document, error: documentError } = await supabase
        .from('documents')
        .insert({
          organization_id: profile.organizationId,
          document_type: pd.documentType,
          document_number: documentNumber,
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
        })
        .select('id, document_number')
        .single();
      if (documentError) throw documentError;

      const itemRows = pd.items.map((item, index) => ({
        document_id: document.id,
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

      await db.pendingDocuments.update(pd.localId, {
        status: 'synced',
        remoteId: document.id,
        remoteDocumentNumber: document.document_number,
      });
      result.documentsSynced += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db.pendingDocuments.update(pd.localId, { status: 'error', errorMessage: message });
      result.errors.push(`Document ${pd.clientLabel} : ${message}`);
    }
  }

  return result;
}
