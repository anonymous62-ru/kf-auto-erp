'use client';

import { useState, useTransition } from 'react';
import { convertToFacture } from '@/lib/documents/actions';

// Bouton client (au lieu d'un simple <form>) : désactivé pendant la
// conversion pour éviter le double clic, et affiche le vrai message en cas
// de refus.
export function ConvertToFactureButton({ documentId }: { documentId: string }) {
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
            const result = await convertToFacture(documentId);
            if (result?.error) setError(result.error);
          });
        }}
        className="w-full rounded-lg bg-kf-orange py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {isPending ? 'Conversion en cours...' : 'Convertir en facture'}
      </button>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
