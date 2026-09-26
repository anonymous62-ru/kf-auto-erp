'use client';

// Vue d'un document cree hors-ligne, pas encore synchronise avec le serveur.
// Le numero officiel n'existe pas encore (attribue seulement a la synchro).
// Des que la synchro reussit, on redirige automatiquement vers la vraie
// fiche document (/documents/[id]) une fois le vrai id connu.
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db, type PendingDocument } from '@/lib/offline/db';
import { runSync } from '@/lib/offline/sync';
import { formatCFA } from '@/lib/documents/calculations';

const DOCUMENT_LABELS: Record<string, string> = {
  proforma: 'Proforma',
  devis: 'Devis',
  facture: 'Facture',
  bon_livraison: 'Bon de livraison',
  recu: 'Reçu',
  avoir: 'Avoir',
};

export default function LocalDocumentPage() {
  const params = useParams<{ localId: string }>();
  const decodedId = decodeURIComponent(params.localId);
  const router = useRouter();
  const [doc, setDoc] = useState<PendingDocument | null | undefined>(undefined);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const record = await db.pendingDocuments.get(decodedId);
      if (cancelled) return;
      setDoc(record ?? null);
      if (record?.status === 'synced' && record.remoteId) {
        router.replace(`/documents/${record.remoteId}`);
      }
    }
    void load();

    const interval = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [decodedId, router]);

  async function handleRetry() {
    setSyncing(true);
    await runSync();
    const record = await db.pendingDocuments.get(decodedId);
    setDoc(record ?? null);
    if (record?.status === 'synced' && record.remoteId) {
      router.replace(`/documents/${record.remoteId}`);
    }
    setSyncing(false);
  }

  if (doc === undefined) return <p className="text-sm text-gray-500">Chargement...</p>;
  if (doc === null) return <p className="text-sm text-red-600">Document local introuvable.</p>;

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
        {doc.status === 'error'
          ? "Échec de la synchronisation. Le document reste enregistré sur cet appareil."
          : 'Créé hors connexion, en attente de synchronisation. Rien n\'est perdu, le document sera envoyé automatiquement dès que le réseau revient.'}
      </div>

      <h1 className="text-lg font-medium">
        {DOCUMENT_LABELS[doc.documentType] ?? doc.documentType} - <span className="text-gray-400">en attente de numéro</span>
      </h1>

      <section className="bg-white rounded-lg border p-3 text-sm space-y-1">
        <p className="text-xs text-gray-500">Client</p>
        <p className="font-medium">{doc.clientLabel}</p>
      </section>

      <section className="bg-white rounded-lg border p-3 space-y-2">
        <p className="text-xs text-gray-500">Articles</p>
        {doc.items.map((item, i) => (
          <div key={i} className="flex justify-between text-sm border-b last:border-0 pb-1.5 last:pb-0">
            <span>
              {item.designation} × {item.quantity}
            </span>
            <span>{formatCFA(item.quantity * item.unitPrice)}</span>
          </div>
        ))}
        <div className="flex justify-between font-medium border-t pt-1.5 text-sm">
          <span>Total TTC</span>
          <span>{formatCFA(doc.totalAmount)}</span>
        </div>
      </section>

      {doc.errorMessage && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{doc.errorMessage}</p>
      )}

      <button
        onClick={handleRetry}
        disabled={syncing || !navigator.onLine}
        className="w-full bg-kf-navy text-white rounded-md py-3 text-sm font-medium disabled:opacity-50"
      >
        {syncing ? 'Synchronisation...' : !navigator.onLine ? 'Hors ligne' : 'Réessayer la synchronisation'}
      </button>
    </div>
  );
}
