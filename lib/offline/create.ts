// Creation de client / document avec bascule automatique online/offline.
// C'est le coeur du "chemin d'or" : le commercial ne doit JAMAIS etre bloque
// par une coupure reseau. Si l'ecriture directe echoue pour une raison
// reseau, on ecrit en local (Dexie) et la synchronisation se fera plus tard.
import { createClient } from '@/lib/supabase/client';
import { db, isLocalId, newLocalId, type DocumentType, type PendingDocumentItem } from '@/lib/offline/db';
import { getCachedProfile } from '@/lib/offline/profile';
import { computeDocumentTotals, type DocumentItemInput } from '@/lib/documents/calculations';
import type { ClientOption } from '@/lib/offline/cache';

function isNetworkError(e: unknown) {
  if (!navigator.onLine) return true;
  if (e instanceof TypeError) return true;
  const message = e instanceof Error ? e.message : String(e);
  return /fetch|network|failed to fetch|load failed/i.test(message);
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

  if (navigator.onLine) {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('clients')
        .insert({
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
      if (!isNetworkError(e)) throw e instanceof Error ? e : new Error(String(e));
      // sinon on bascule silencieusement sur le chemin hors-ligne ci-dessous
    }
  }

  const localId = newLocalId();
  await db.pendingClients.add({
    localId,
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

      const { data: document, error: documentError } = await supabase
        .from('documents')
        .insert({
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

      return { kind: 'remote', id: document.id, documentNumber: document.document_number };
    } catch (e) {
      if (!isNetworkError(e)) throw e instanceof Error ? e : new Error(String(e));
      // reseau indisponible malgre navigator.onLine : bascule hors-ligne ci-dessous
    }
  }

  const localId = newLocalId();
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
