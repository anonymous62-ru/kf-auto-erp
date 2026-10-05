// Creation de client / document avec bascule automatique online/offline.
// C'est le coeur du "chemin d'or" : le commercial ne doit JAMAIS etre bloque
// par une coupure reseau. Si l'ecriture directe echoue pour une raison
// reseau, on ecrit en local (Dexie) et la synchronisation se fera plus tard.
import { createClient } from '@/lib/supabase/client';
import { db, isLocalId, newLocalId, type DocumentType, type PendingDocumentItem } from '@/lib/offline/db';
import { getCachedProfile } from '@/lib/offline/profile';
import { computeDocumentTotals, type DocumentItemInput } from '@/lib/documents/calculations';
import { applyFactureStockDeduction } from '@/lib/documents/stock-deduction';
import type { ClientOption } from '@/lib/offline/cache';

// Les erreurs Supabase (PostgrestError) ne sont pas toujours des instances
// d'Error : sur coupure reseau elles portent seulement un message du type
// "TypeError: Failed to fetch". On lit donc le message quel que soit le type.
function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return String(e);
}

function isNetworkError(e: unknown) {
  if (!navigator.onLine) return true;
  if (e instanceof TypeError) return true;
  return /fetch|network|failed to fetch|load failed/i.test(errorMessage(e));
}

function toError(e: unknown) {
  return e instanceof Error ? e : new Error(errorMessage(e));
}

// ---------- Client ----------
export interface QuickClientInput {
  firstName?: string;
  lastName?: string;
  companyName?: string;
  phone?: string;
  email?: string;
  address?: string;
}

export async function createQuickClientSmart(input: QuickClientInput): Promise<ClientOption> {
  const profile = await getCachedProfile();
  if (!profile) throw new Error("Profil introuvable. Connectez-vous au moins une fois en ligne avant de travailler hors-ligne.");

  // uuid genere ici et reutilise tel quel si on bascule hors-ligne : si
  // l'insertion en ligne a en fait abouti avant la coupure, la synchro
  // retrouvera la ligne par cet id au lieu de creer un doublon.
  const serverId = crypto.randomUUID();

  if (navigator.onLine) {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('clients')
        .insert({
          id: serverId,
          organization_id: profile.organizationId,
          assigned_to: profile.userId,
          created_by: profile.userId,
          first_name: input.firstName,
          last_name: input.lastName,
          company_name: input.companyName,
          phone: input.phone,
          email: input.email || null,
          address: input.address || null,
        })
        .select('id, first_name, last_name, company_name, phone, email, address')
        .single();
      if (error) throw error;
      await db.cachedClients.put({
        id: data.id,
        firstName: data.first_name ?? undefined,
        lastName: data.last_name ?? undefined,
        companyName: data.company_name ?? undefined,
        phone: data.phone ?? undefined,
        email: data.email ?? undefined,
        address: data.address ?? undefined,
        updatedAt: new Date().toISOString(),
      });
      return data;
    } catch (e) {
      if (!isNetworkError(e)) throw toError(e);
      // sinon on bascule silencieusement sur le chemin hors-ligne ci-dessous
    }
  }

  const localId = newLocalId(serverId);
  await db.pendingClients.add({
    localId,
    serverId,
    organizationId: profile.organizationId,
    firstName: input.firstName,
    lastName: input.lastName,
    companyName: input.companyName,
    phone: input.phone,
    email: input.email,
    address: input.address,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  return {
    id: localId,
    first_name: input.firstName,
    last_name: input.lastName,
    company_name: input.companyName,
    phone: input.phone,
    email: input.email,
    address: input.address,
  };
}

// ---------- Document ----------
export interface CreateDocumentSmartInput {
  documentType: DocumentType;
  clientId: string;
  clientLabel: string;
  items: Array<DocumentItemInput & { designation: string; productId?: string }>;
  notes?: string;
}

export type CreateDocumentSmartResult =
  | { kind: 'remote'; id: string; documentNumber: string }
  | { kind: 'local'; localId: string };

export async function createDocumentSmart(input: CreateDocumentSmartInput): Promise<CreateDocumentSmartResult> {
  if (input.items.length === 0) throw new Error('Ajoutez au moins un article');

  const profile = await getCachedProfile();
  if (!profile) throw new Error("Profil introuvable. Connectez-vous au moins une fois en ligne avant de travailler hors-ligne.");

  const totals = computeDocumentTotals(input.items);
  const clientPending = isLocalId(input.clientId);

  // Meme principe que pour le client : id stable genere sur l'appareil,
  // repris par l'element en attente en cas de bascule hors-ligne.
  const serverId = crypto.randomUUID();
  // Numero deja obtenu en ligne avant une coupure : transmis a la file
  // d'attente pour ne pas en consommer un second a la synchro.
  let reservedDocumentNumber: string | undefined;

  if (navigator.onLine && !clientPending) {
    try {
      const supabase = createClient();
      const year = new Date().getFullYear();
      const { data: documentNumber, error: numberError } = await supabase.rpc('get_next_document_number', {
        p_organization_id: profile.organizationId,
        p_document_type: input.documentType,
        p_year: year,
      });
      if (numberError) throw numberError;
      reservedDocumentNumber = documentNumber as string;

      const { data: document, error: documentError } = await supabase
        .from('documents')
        .insert({
          id: serverId,
          organization_id: profile.organizationId,
          document_type: input.documentType,
          document_number: documentNumber,
          status: 'brouillon',
          client_id: input.clientId,
          commercial_id: profile.userId,
          issue_date: new Date().toISOString().slice(0, 10),
          due_date: (() => {
            const d = new Date();
            d.setMonth(d.getMonth() + 1);
            return d.toISOString().slice(0, 10);
          })(),
          subtotal: totals.subtotal,
          tax_amount: totals.taxAmount,
          total_amount: totals.totalAmount,
          notes: input.notes,
        })
        .select('id, document_number')
        .single();
      if (documentError) throw documentError;

      const itemRows = input.items.map((item, index) => ({
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

      // Règle du DG (04/10) : une facture retire automatiquement du stock.
      if (input.documentType === 'facture') {
        await applyFactureStockDeduction(supabase, {
          organizationId: profile.organizationId,
          documentId: document.id,
          documentNumber: document.document_number,
          items: input.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          performedBy: profile.userId,
        });
      }

      return { kind: 'remote', id: document.id, documentNumber: document.document_number };
    } catch (e) {
      if (!isNetworkError(e)) throw toError(e);
      // reseau indisponible malgre navigator.onLine : bascule hors-ligne
      // ci-dessous. Le document a pu etre cree cote serveur avant la coupure :
      // la synchro le retrouvera par serverId et terminera (lignes, stock).
    }
  }

  const localId = newLocalId(serverId);
  const items: PendingDocumentItem[] = input.items.map((item) => ({
    productId: item.productId,
    designation: item.designation,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    taxRate: item.taxRate,
    discountPercent: item.discountPercent ?? 0,
  }));
  await db.pendingDocuments.add({
    localId,
    serverId,
    reservedDocumentNumber,
    documentType: input.documentType,
    clientId: input.clientId,
    clientLabel: input.clientLabel,
    items,
    notes: input.notes,
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    totalAmount: totals.totalAmount,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  return { kind: 'local', localId };
}
