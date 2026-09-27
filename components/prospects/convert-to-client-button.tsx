'use client';

import { useState, useTransition } from 'react';
import { convertProspectToClient } from '@/lib/prospects/actions';

export function ConvertToClientButton({ prospectId }: { prospectId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConvert() {
    setError(null);
    startTransition(async () => {
      try {
        await convertProspectToClient(prospectId);
      } catch (e) {
        if (e instanceof Error && e.message === 'NEXT_REDIRECT') throw e;
        setError(e instanceof Error ? e.message : 'Erreur lors de la conversion');
      }
    });
  }

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="btn-primary w-full justify-center">
        Convertir en client
      </button>
    );
  }

  return (
    <div className="card p-3 space-y-2 border-green-200 bg-green-50">
      <p className="text-sm text-gray-700">
        Créer une fiche client à partir de ce prospect ? Ses informations (nom, téléphone, email) seront reprises.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleConvert}
          disabled={isPending}
          className="flex-1 bg-green-600 text-white rounded-md py-2 text-sm font-medium disabled:opacity-50"
        >
          {isPending ? 'Conversion...' : 'Confirmer'}
        </button>
        <button onClick={() => setConfirming(false)} className="flex-1 border rounded-md py-2 text-sm">
          Annuler
        </button>
      </div>
    </div>
  );
}
