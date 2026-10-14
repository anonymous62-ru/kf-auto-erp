'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { removeEvent, setEventStatus } from '@/lib/crm/agenda';

export function EventActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ error?: string }>) {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {status !== 'fait' && (
        <button type="button" disabled={isPending} onClick={() => run(() => setEventStatus(id, 'fait'))} className="text-xs text-green-700 hover:underline">
          Fait
        </button>
      )}
      {status === 'prevu' && (
        <button type="button" disabled={isPending} onClick={() => run(() => setEventStatus(id, 'annule'))} className="text-xs text-gray-500 hover:underline">
          Annuler
        </button>
      )}
      {status !== 'prevu' && (
        <button type="button" disabled={isPending} onClick={() => run(() => setEventStatus(id, 'prevu'))} className="text-xs text-gray-500 hover:underline">
          Rétablir
        </button>
      )}
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (confirm('Supprimer cet événement ?')) run(() => removeEvent(id));
        }}
        className="text-xs text-red-600 hover:underline"
      >
        Supprimer
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
