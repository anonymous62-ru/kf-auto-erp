'use client';

import { useState, useTransition } from 'react';
import { createPart } from '@/lib/pieces/actions';
import { useRouter } from 'next/navigation';

export default function NewPartPage() {
  const [reference, setReference] = useState('');
  const [designation, setDesignation] = useState('');
  const [brand, setBrand] = useState('');
  const [compatibleModels, setCompatibleModels] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [location, setLocation] = useState('');
  const [purchasePrice, setPurchasePrice] = useState(0);
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
        await createPart({
          reference,
          designation,
          brand,
          compatibleModels,
          supplierName,
          location,
          purchasePrice,
          salePrice,
          taxRate,
          quantityOnHand,
          stockMin,
        });
        router.push('/pieces');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur');
      }
    });
  }

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-medium">Nouvelle pièce</h1>
      <div className="bg-white rounded-lg border p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500 block">
            Référence
            <input value={reference} onChange={(e) => setReference(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
          </label>
          <label className="text-xs text-gray-500 block">
            Marque
            <input value={brand} onChange={(e) => setBrand(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
          </label>
        </div>
        <label className="text-xs text-gray-500 block">
          Désignation
          <input value={designation} onChange={(e) => setDesignation(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
        </label>
        <label className="text-xs text-gray-500 block">
          Modèles compatibles (optionnel)
          <input
            value={compatibleModels}
            onChange={(e) => setCompatibleModels(e.target.value)}
            placeholder="Tiggo 4, Tiggo 7..."
            className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500 block">
            Fournisseur
            <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
          </label>
          <label className="text-xs text-gray-500 block">
            Emplacement magasin
            <input value={location} onChange={(e) => setLocation(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500 block">
            Prix d'achat (FCFA)
            <input type="number" value={purchasePrice} onChange={(e) => setPurchasePrice(Number(e.target.value))} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
          </label>
          <label className="text-xs text-gray-500 block">
            Prix de vente (FCFA)
            <input type="number" value={salePrice} onChange={(e) => setSalePrice(Number(e.target.value))} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs text-gray-500 block">
            TVA %
            <input type="number" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
          </label>
          <label className="text-xs text-gray-500 block">
            Stock initial
            <input type="number" value={quantityOnHand} onChange={(e) => setQuantityOnHand(Number(e.target.value))} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
          </label>
          <label className="text-xs text-gray-500 block">
            Seuil d'alerte
            <input type="number" value={stockMin} onChange={(e) => setStockMin(Number(e.target.value))} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
          </label>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button onClick={handleSubmit} disabled={isPending} className="w-full bg-kf-navy text-white rounded-md py-2.5 text-sm font-medium">
          {isPending ? 'Enregistrement...' : 'Créer la pièce'}
        </button>
      </div>
    </div>
  );
}
