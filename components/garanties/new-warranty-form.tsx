'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createWarranty } from '@/lib/garanties/actions';

export function NewWarrantyForm({
  clients,
  models,
}: {
  clients: { id: string; label: string }[];
  models: { id: string; designation: string; brand: string | null; model: string | null }[];
}) {
  const [clientId, setClientId] = useState('');
  const [productId, setProductId] = useState('');
  const [vehicleVin, setVehicleVin] = useState('');
  const [brand, setBrand] = useState('Chery');
  const [model, setModel] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [durationMonths, setDurationMonths] = useState(36);
  const [mileageLimit, setMileageLimit] = useState(100000);
  const [coveredParts, setCoveredParts] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleProductSelect(id: string) {
    setProductId(id);
    const p = models.find((m) => m.id === id);
    if (p) {
      setBrand(p.brand || brand);
      setModel(p.model || model);
    }
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        await createWarranty({
          clientId: clientId || undefined,
          productId: productId || undefined,
          vehicleVin,
          brand: brand || undefined,
          model: model || undefined,
          startDate,
          durationMonths,
          mileageLimit,
          coveredParts: coveredParts || undefined,
        });
        router.push('/garanties');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur');
      }
    });
  }

  return (
    <div className="bg-white rounded-lg border p-3 space-y-2">
      <label className="text-xs text-gray-500 block">
        Client (optionnel)
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5">
          <option value="">— Aucun client sélectionné —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-gray-500 block">
        Modèle vendu (catalogue, optionnel)
        <select value={productId} onChange={(e) => handleProductSelect(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5">
          <option value="">— Aucun —</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.designation}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-gray-500 block">
        VIN / N° de châssis
        <input value={vehicleVin} onChange={(e) => setVehicleVin(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-500 block">
          Marque
          <input value={brand} onChange={(e) => setBrand(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
        </label>
        <label className="text-xs text-gray-500 block">
          Modèle
          <input value={model} onChange={(e) => setModel(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
        </label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs text-gray-500 block">
          Date de mise en circulation
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
        </label>
        <label className="text-xs text-gray-500 block">
          Durée (mois)
          <input type="number" value={durationMonths} onChange={(e) => setDurationMonths(Number(e.target.value))} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
        </label>
        <label className="text-xs text-gray-500 block">
          Km couverts
          <input type="number" value={mileageLimit} onChange={(e) => setMileageLimit(Number(e.target.value))} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
        </label>
      </div>
      <label className="text-xs text-gray-500 block">
        Pièces/organes couverts (optionnel)
        <textarea value={coveredParts} onChange={(e) => setCoveredParts(e.target.value)} rows={2} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
      </label>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button onClick={handleSubmit} disabled={isPending} className="w-full bg-kf-navy text-white rounded-md py-2.5 text-sm font-medium">
        {isPending ? 'Enregistrement...' : 'Créer la garantie'}
      </button>
    </div>
  );
}
