'use client';

import { useState, useTransition } from 'react';
import { convertDocument } from '@/lib/documents/actions';

// Bouton client (au lieu d'un simple <form>) : désactivé pendant la
// conversion pour éviter le double clic, et affiche le vrai message en cas
// de refus.
export function ConvertDocumentButton({
  documentId,
  target,
  label,
}: {
  documentId: string;
  target: 'commande' | 'facture';
  label: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (isPending) return;
          setError(null);
          startTransition(async () => {
            const result = await convertDocument(documentId, target);
            if (result?.error) setError(result.error);
          });
        }}
        className="btn-primary w-full"
      >
        {isPending ? 'Conversion en cours...' : label}
      </button>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
