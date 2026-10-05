'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClaim, updateClaimStatus } from '@/lib/garanties/actions';
import { formatCFA } from '@/lib/documents/calculations';
import { IconPlus } from '@/components/icons';

interface Claim {
  id: string;
  description: string | null;
  amount_requested: number;
  amount_covered: number;
  status: 'soumise' | 'acceptee' | 'refusee' | 'remboursee';
  submitted_at: string;
  repair_order_id: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  soumise: 'Soumise',
  acceptee: 'Acceptée',
  refusee: 'Refusée',
  remboursee: 'Remboursée',
};

export function ClaimManager({ warrantyId, claims }: { warrantyId: string; claims: Claim[] }) {
  const [description, setDescription] = useState('');
  const [amountRequested, setAmountRequested] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      try {
        await createClaim({ warrantyId, description: description || undefined, amountRequested });
        setDescription('');
        setAmountRequested(0);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur');
      }
    });
  }

  function handleDecision(claimId: string, status: 'acceptee' | 'refusee' | 'remboursee', amountCovered?: number) {
    startTransition(async () => {
      await updateClaimStatus({ claimId, warrantyId, status, amountCovered });
      router.refresh();
    });
  }

  return (
    <div className="card p-4 space-y-3">
      <h2 className="text-sm font-semibold text-kf-navy">Dossiers de prise en charge</h2>

      {claims.length === 0 && <p className="text-xs text-gray-500">Aucun dossier pour le moment.</p>}
      <div className="space-y-2">
        {claims.map((c) => (
          <div key={c.id} className="border border-gray-100 rounded-md p-2 text-xs space-y-1">
            <div className="flex justify-between items-center">
              <span className="font-medium">{c.description || 'Dossier de garantie'}</span>
              <span
                className={`badge ${
                  c.status === 'remboursee' || c.status === 'acceptee'
                    ? 'badge-green'
                    : c.status === 'refusee'
                      ? 'badge-red'
                      : 'badge-orange'
                }`}
              >
                {STATUS_LABELS[c.status]}
              </span>
            </div>
            <p className="text-gray-500">
              Demandé : {formatCFA(Number(c.amount_requested))}
              {c.amount_covered > 0 && ` · Pris en charge : ${formatCFA(Number(c.amount_covered))}`}
            </p>
            {c.status === 'soumise' && (
              <div className="flex gap-1.5 pt-1">
                <button
                  onClick={() => handleDecision(c.id, 'acceptee', Number(c.amount_requested))}
                  disabled={isPending}
                  className="btn-secondary text-[11px] px-2 py-1"
                >
                  Accepter
                </button>
                <button onClick={() => handleDecision(c.id, 'refusee')} disabled={isPending} className="btn-danger-ghost text-[11px] px-2 py-1">
                  Refuser
                </button>
              </div>
            )}
            {c.status === 'acceptee' && (
              <button onClick={() => handleDecision(c.id, 'remboursee', Number(c.amount_covered || c.amount_requested))} disabled={isPending} className="btn-primary text-[11px] px-2 py-1 mt-1">
                Marquer remboursé par le constructeur
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="border-t pt-3 space-y-2">
        <label className="text-xs text-gray-500 block">
          Description du dossier
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="ex. Défaut moteur sous garantie" className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
        </label>
        <label className="text-xs text-gray-500 block">
          Montant demandé (FCFA)
          <input type="number" value={amountRequested} onChange={(e) => setAmountRequested(Number(e.target.value))} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button onClick={handleCreate} disabled={isPending} className="btn-secondary w-full text-sm">
          <IconPlus className="w-3.5 h-3.5" /> Soumettre un dossier
        </button>
      </div>
    </div>
  );
}
