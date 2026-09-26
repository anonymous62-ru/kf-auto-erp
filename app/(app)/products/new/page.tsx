'use client';

import { useState, useTransition } from 'react';
import { createProduct } from '@/lib/products/actions';
import { useRouter } from 'next/navigation';

export default function NewProductPage() {
  const [designation, setDesignation] = useState('');
  const [sku, setSku] = useState('');
  const [salePrice, setSalePrice] = useState(0);
  const [taxRate, setTaxRate] = useState(18);
  const [quantityOnHand, setQuantityOnHand] = useState(0);
  const [stockMin, setStockMin] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        await createProduct({ designation, sku, salePrice, taxRate, quantityOnHand, stockMin });
        router.push('/products');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur');
      }
    });
  }

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-medium">Nouveau produit</h1>
      <div className="bg-white rounded-lg border p-3 space-y-2">
        <label className="text-xs text-gray-500 block">
          Désignation
          <input
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
          />
        </label>
        <label className="text-xs text-gray-500 block">
          SKU (optionnel)
          <input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500 block">
            Prix de vente (FCFA)
            <input
              type="number"
              value={salePrice}
              onChange={(e) => setSalePrice(Number(e.target.value))}
              className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
            />
          </label>
          <label className="text-xs text-gray-500 block">
            TVA %
            <input
              type="number"
              value={taxRate}
              onChange={(e) => setTaxRate(Number(e.target.value))}
              className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500 block">
            Quantité en stock
            <input
              type="number"
              value={quantityOnHand}
              onChange={(e) => setQuantityOnHand(Number(e.target.value))}
              className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
            />
          </label>
          <label className="text-xs text-gray-500 block">
            Stock minimum (alerte)
            <input
              type="number"
              value={stockMin}
              onChange={(e) => setStockMin(Number(e.target.value))}
              className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
            />
          </label>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="w-full bg-kf-navy text-white rounded-md py-2.5 text-sm font-medium"
        >
          {isPending ? 'Enregistrement...' : 'Créer le produit'}
        </button>
      </div>
    </div>
  );
}
