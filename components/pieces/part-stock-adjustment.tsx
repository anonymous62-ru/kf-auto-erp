'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { adjustPartStock } from '@/lib/pieces/actions';
import { IconAlert, IconCheck, IconX } from '@/components/icons';

export function PartStockAdjustment({
  partId,
  designation,
  quantityOnHand,
  quantityReserved,
  stockMin,
}: {
  partId: string;
  designation: string;
  quantityOnHand: number;
  quantityReserved: number;
  stockMin: number;
}) {
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const available = quantityOnHand - quantityReserved;
  const low = available <= stockMin;

  function apply(sign: 1 | -1) {
    setError(null);
    setSuccess(null);
    const qty = sign * Math.abs(amount);
    if (!qty) return;
    startTransition(async () => {
      try {
        await adjustPartStock({ partId, quantity: qty, reason: reason || undefined });
        setSuccess(sign > 0 ? `+${Math.abs(amount)} réceptionné(s).` : `${Math.abs(amount)} sorti(s) du stock.`);
        setReason('');
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Échec de la mise à jour du stock.');
      }
    });
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-kf-navy">Stock</h2>
        <p className={`text-sm font-semibold flex items-center gap-1 ${low ? 'text-kf-red' : 'text-gray-900'}`}>
          {low && <IconAlert className="w-3.5 h-3.5" />}
          {available} disponible{available > 1 ? 's' : ''} {low && '(sous le seuil)'}
        </p>
      </div>
      <p className="text-xs text-gray-500">
        {quantityOnHand} en stock, dont {quantityReserved} réservée{quantityReserved > 1 ? 's' : ''} pour des ordres de réparation en cours.
      </p>

      <div className="flex items-end gap-2">
        <label className="text-xs text-gray-500 block">
          Quantité
          <input type="number" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))} className="input mt-1 w-24" />
        </label>
        <label className="text-xs text-gray-500 block flex-1">
          Motif (optionnel)
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`ex. réception fournisseur ${designation}`} className="input mt-1" />
        </label>
      </div>

      <div className="flex gap-2">
        <button type="button" className="btn-primary flex-1" disabled={isPending} onClick={() => apply(1)}>
          + Réception
        </button>
        <button type="button" className="btn-danger-ghost flex-1" disabled={isPending} onClick={() => apply(-1)}>
          - Sortie
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1">
          <IconX className="w-3.5 h-3.5" /> {error}
        </p>
      )}
      {success && (
        <p className="text-xs text-green-600 flex items-center gap-1">
          <IconCheck className="w-3.5 h-3.5" /> {success}
        </p>
      )}
    </div>
  );
}
