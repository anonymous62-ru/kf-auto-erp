'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPartAvailability } from '@/lib/pieces/actions';
import { IconCheck, IconX } from '@/components/icons';

// Le "crochet" Super Admin demandé par le DG (04/10) : les pièces importées
// depuis les commandes Chine arrivent avec is_active = false (pas de prix de
// vente local encore saisi). Seul le Super Admin peut activer la disponibilité
// à la vente ; les autres rôles voient juste un badge en lecture seule
// (cf. PartAvailabilityBadge dans la liste des pièces).
export function PartAvailabilityToggle({ partId, isActive }: { partId: string; isActive: boolean }) {
  const [active, setActive] = useState(isActive);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function toggle() {
    const next = !active;
    setError(null);
    startTransition(async () => {
      try {
        await setPartAvailability(partId, next);
        setActive(next);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Échec de la mise à jour.');
      }
    });
  }

  return (
    <div className="card p-4 space-y-2 border-l-4 border-l-kf-orange">
      <h2 className="text-sm font-semibold text-kf-navy">Disponibilité à la vente (Super Admin)</h2>
      <p className="text-xs text-gray-500">
        Une pièce désactivée reste en stock mais n&apos;apparaît pas dans les devis, commandes ou factures.
      </p>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={active} disabled={isPending} onChange={toggle} />
        {active ? 'Disponible à la vente' : "En attente d'activation"}
      </label>
      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1">
          <IconX className="w-3.5 h-3.5" /> {error}
        </p>
      )}
      {!error && (
        <p className="text-xs text-gray-400 flex items-center gap-1">
          <IconCheck className="w-3.5 h-3.5" /> Modifié automatiquement, sans bouton de validation.
        </p>
      )}
    </div>
  );
}

export function PartAvailabilityBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full ${
        isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
      }`}
    >
      {isActive ? 'Disponible' : "En attente d'activation"}
    </span>
  );
}
