'use client';

// Petit widget dashboard : liste les documents crees hors-ligne et pas
// encore synchronises, avec acces direct a chacun.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { db, type PendingDocument } from '@/lib/offline/db';
import { SYNC_EVENT } from '@/components/offline/sync-provider';
import { formatCFA } from '@/lib/documents/calculations';

export function PendingDocumentsWidget() {
  const [docs, setDocs] = useState<PendingDocument[]>([]);

  useEffect(() => {
    async function refresh() {
      const all = await db.pendingDocuments.where('status').anyOf('pending', 'syncing', 'error').sortBy('createdAt');
      setDocs(all.reverse());
    }
    void refresh();
    window.addEventListener(SYNC_EVENT, refresh);
    const interval = setInterval(refresh, 10_000);
    return () => {
      window.removeEventListener(SYNC_EVENT, refresh);
      clearInterval(interval);
    };
  }, []);

  if (docs.length === 0) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
      <p className="text-xs font-medium text-amber-800">
        {docs.length} document{docs.length > 1 ? 's' : ''} en attente de synchronisation
      </p>
      <div className="space-y-1">
        {docs.map((d) => (
          <Link
            key={d.localId}
            href={`/documents/local/${encodeURIComponent(d.localId)}`}
            className="flex justify-between text-sm bg-white rounded-md px-2 py-1.5 border border-amber-100"
          >
            <span>{d.clientLabel}</span>
            <span className="text-gray-500">{formatCFA(d.totalAmount)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
