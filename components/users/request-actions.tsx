'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { approveUserRequest, rejectUserRequest } from '@/lib/users/requests';

// Boutons Valider / Refuser d'une demande d'inscription (direction).
// À la validation, le compte est créé et le mot de passe temporaire est
// affiché une seule fois, pour être transmis à l'agent.
export function RequestActions({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string; fullName: string } | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');

  if (created) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm space-y-1">
        <p className="font-medium text-green-800">Compte créé pour {created.fullName}</p>
        <p className="text-gray-700">
          E-mail : <span className="font-medium">{created.email}</span>
        </p>
        <p className="text-gray-700">
          Mot de passe temporaire : <span className="font-mono font-medium">{created.password}</span>
        </p>
        <p className="text-xs text-gray-500">Notez-le maintenant : il ne sera plus affiché. L&apos;agent le change à sa première connexion.</p>
        <button type="button" onClick={() => router.refresh()} className="btn-secondary mt-2">
          J&apos;ai noté, fermer
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rejecting ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Motif du refus (optionnel)"
            className="input"
          />
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const r = await rejectUserRequest(requestId, note);
                if (r.error) setError(r.error);
                else router.refresh();
              })
            }
            className="btn-secondary shrink-0 text-red-700"
          >
            Confirmer le refus
          </button>
          <button type="button" onClick={() => setRejecting(false)} className="btn-secondary shrink-0">
            Annuler
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const r = await approveUserRequest(requestId);
                if (r.error) setError(r.error);
                else if (r.email && r.password) setCreated({ email: r.email, password: r.password, fullName: r.fullName ?? '' });
              })
            }
            className="btn-primary"
          >
            {isPending ? 'Création du compte...' : 'Valider et créer le compte'}
          </button>
          <button type="button" disabled={isPending} onClick={() => setRejecting(true)} className="btn-secondary">
            Refuser
          </button>
        </div>
      )}
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
