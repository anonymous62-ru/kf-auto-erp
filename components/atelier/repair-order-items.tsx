'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addRepairOrderItem, removeRepairOrderItem } from '@/lib/atelier/actions';
import { formatCFA } from '@/lib/documents/calculations';
import { IconX, IconPlus } from '@/components/icons';

interface Item {
  id: string;
  item_type: 'main_oeuvre' | 'piece';
  part_id: string | null;
  designation: string;
  quantity: number;
  unit_price: number;
}

interface PartOption {
  id: string;
  reference: string;
  designation: string;
  sale_price: number;
  quantity_on_hand: number;
  quantity_reserved: number;
}

export function RepairOrderItems({
  repairOrderId,
  items,
  parts,
  readOnly,
}: {
  repairOrderId: string;
  items: Item[];
  parts: PartOption[];
  readOnly: boolean;
}) {
  const [itemType, setItemType] = useState<'main_oeuvre' | 'piece'>('main_oeuvre');
  const [partId, setPartId] = useState('');
  const [designation, setDesignation] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const total = items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unit_price), 0);

  function handlePartSelect(id: string) {
    setPartId(id);
    const part = parts.find((p) => p.id === id);
    if (part) {
      setDesignation(`${part.designation} (${part.reference})`);
      setUnitPrice(Number(part.sale_price));
    }
  }

  function handleAdd() {
    setError(null);
    if (!designation.trim()) {
      setError('Désignation obligatoire');
      return;
    }
    startTransition(async () => {
      try {
        await addRepairOrderItem({
          repairOrderId,
          itemType,
          partId: itemType === 'piece' ? partId || undefined : undefined,
          designation,
          quantity,
          unitPrice,
        });
        setDesignation('');
        setPartId('');
        setQuantity(1);
        setUnitPrice(0);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur');
      }
    });
  }

  function handleRemove(itemId: string) {
    startTransition(async () => {
      await removeRepairOrderItem(itemId, repairOrderId);
      router.refresh();
    });
  }

  return (
    <div className="card p-4 space-y-3">
      <h2 className="text-sm font-semibold text-kf-navy">Main d'œuvre et pièces</h2>

      {items.length === 0 && <p className="text-xs text-gray-500">Aucune ligne pour le moment.</p>}
      <div className="space-y-1.5">
        {items.map((i) => (
          <div key={i.id} className="flex justify-between items-center text-xs border-b border-gray-100 pb-1.5 last:border-0">
            <div>
              <p className="font-medium text-gray-800">
                {i.designation} {i.item_type === 'piece' && <span className="badge badge-gray ml-1">pièce</span>}
              </p>
              <p className="text-gray-500">
                {i.quantity} × {formatCFA(Number(i.unit_price))}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{formatCFA(Number(i.quantity) * Number(i.unit_price))}</span>
              {!readOnly && (
                <button onClick={() => handleRemove(i.id)} className="text-gray-400 hover:text-kf-red">
                  <IconX className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-between text-sm font-semibold pt-1">
        <span>Total devis (HT)</span>
        <span>{formatCFA(total)}</span>
      </div>

      {!readOnly && (
        <div className="border-t pt-3 space-y-2">
          <div className="flex gap-2">
            <select value={itemType} onChange={(e) => setItemType(e.target.value as 'main_oeuvre' | 'piece')} className="border rounded-md px-2 py-1.5 text-sm">
              <option value="main_oeuvre">Main d'œuvre</option>
              <option value="piece">Pièce</option>
            </select>
            {itemType === 'piece' && (
              <select value={partId} onChange={(e) => handlePartSelect(e.target.value)} className="flex-1 border rounded-md px-2 py-1.5 text-sm">
                <option value="">— Choisir une pièce —</option>
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.designation} ({p.reference}) — dispo {Number(p.quantity_on_hand) - Number(p.quantity_reserved)}
                  </option>
                ))}
              </select>
            )}
          </div>
          {itemType === 'main_oeuvre' && (
            <input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="ex. Vidange + filtres" className="w-full border rounded-md px-2 py-1.5 text-sm" />
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-gray-500 block">
              Quantité
              <input type="number" min={0.5} step={0.5} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
            </label>
            <label className="text-xs text-gray-500 block">
              Prix unitaire (FCFA)
              <input type="number" value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
            </label>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button onClick={handleAdd} disabled={isPending} className="btn-secondary w-full text-sm">
            <IconPlus className="w-3.5 h-3.5" /> Ajouter la ligne
          </button>
        </div>
      )}
    </div>
  );
}
