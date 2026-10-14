'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setItemVehicles } from '@/lib/stock/actions';

type Option = { id: string; vin: string; color: string | null; ageText: string; statusLabel: string };

// Choix des numéros de châssis d'une ligne véhicule (commande ou facture).
// Un châssis choisi n'est plus proposé aux autres commerciaux ; la facture ne
// peut être établie que lorsque chaque véhicule a son châssis.
export function ItemVehiclePicker({
  documentId,
  itemId,
  designation,
  quantity,
  selected,
  options,
  editable,
}: {
  documentId: string;
  itemId: string;
  designation: string;
  quantity: number;
  selected: { id: string; vin: string }[];
  options: Option[];
  editable: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(selected.map((s) => s.id));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const missing = Math.max(0, quantity - selected.length);

  function toggle(id: string) {
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= quantity) return quantity === 1 ? [id] : prev;
      return [...prev, id];
    });
  }

  function save() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const r = await setItemVehicles(itemId, picked, documentId);
      if (r.error) setError(r.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 text-sm space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-gray-900 truncate">{designation.split('\n')[0]}</p>
          {selected.length > 0 ? (
            <p className="font-mono text-xs text-gray-700">{selected.map((s) => s.vin).join(', ')}</p>
          ) : (
            <p className="text-xs text-orange-700">Numéro de châssis à choisir</p>
          )}
          {missing > 0 && selected.length > 0 && (
            <p className="text-xs text-orange-700">
              Encore {missing} châssis à choisir
            </p>
          )}
        </div>
        {editable && !open && (
          <button type="button" onClick={() => setOpen(true)} className="btn-secondary shrink-0 text-xs px-3 py-1.5">
            {selected.length > 0 ? 'Changer' : 'Choisir'}
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-2">
          {options.length === 0 ? (
            <p className="text-xs text-gray-500">Aucun véhicule libre de ce modèle en stock.</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto divide-y divide-gray-100 rounded-md border border-gray-200 bg-white">
              {options.map((o) => (
                <li key={o.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50">
                    <input type="checkbox" checked={picked.includes(o.id)} onChange={() => toggle(o.id)} />
                    <span className="min-w-0">
                      <span className="block font-mono text-xs text-gray-900">{o.vin}</span>
                      <span className="block text-xs text-gray-500">
                        {o.color ? `${o.color} · ` : ''}
                        {o.statusLabel} · en stock {o.ageText}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-500">
            {picked.length} / {quantity} choisi{picked.length > 1 ? 's' : ''}. Les plus anciens sont en tête de liste.
          </p>
          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={isPending} className="btn-primary text-xs px-3 py-1.5">
              {isPending ? 'Enregistrement...' : 'Enregistrer'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setPicked(selected.map((s) => s.id));
              }}
              className="btn-secondary text-xs px-3 py-1.5"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
