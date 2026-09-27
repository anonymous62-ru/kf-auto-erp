'use client';

import { useState, useTransition } from 'react';
import { deleteDocument } from '@/lib/documents/actions';

export function DeleteDocumentButton({ documentId, documentNumber }: { documentId: string; documentNumber: string | null }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteDocument(documentId);
      } catch (e) {
        if (e instanceof Error && e.message === 'NEXT_REDIRECT') return;
        setError(e instanceof Error ? e.message : 'Erreur');
        setConfirming(false);
      }
    });
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="w-full border border-red-200 text-red-600 rounded-md py-2.5 text-sm font-medium"
      >
        Supprimer ce document
      </button>
    );
  }

  return (
    <div className="border border-red-200 bg-red-50 rounded-md p-3 space-y-2">
      <p className="text-sm text-red-700">
        Supprimer définitivement {documentNumber ?? 'ce document'} ? Cette action est irréversible.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleDelete}
          disabled={isPending}
          className="flex-1 bg-red-600 text-white rounded-md py-2 text-sm disabled:opacity-60"
        >
          {isPending ? 'Suppression...' : 'Oui, supprimer'}
        </button>
        <button onClick={() => setConfirming(false)} disabled={isPending} className="flex-1 border rounded-md py-2 text-sm">
          Annuler
        </button>
      </div>
    </div>
  );
}
