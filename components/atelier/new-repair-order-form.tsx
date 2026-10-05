'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createRepairOrder } from '@/lib/atelier/actions';

export function NewRepairOrderForm({ clients }: { clients: { id: string; label: string }[] }) {
  const router = useRouter();
  const [clientId, setClientId] = useState('');
  const [vehicleLabel, setVehicleLabel] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleVin, setVehicleVin] = useState('');
  const [vehicleMileageIn, setVehicleMileageIn] = useState<number | ''>('');
  const [diagnostic, setDiagnostic] = useState('');
  const [laborRate, setLaborRate] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createRepairOrder({
          clientId: clientId || undefined,
          vehicleLabel: vehicleLabel || undefined,
          vehiclePlate: vehiclePlate || undefined,
          vehicleVin: vehicleVin || undefined,
          vehicleMileageIn: vehicleMileageIn === '' ? undefined : Number(vehicleMileageIn),
          diagnostic: diagnostic || undefined,
          laborRate,
        });
        router.push(`/atelier/${result.id}`);
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
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-500 block">
          Véhicule (modèle/couleur)
          <input value={vehicleLabel} onChange={(e) => setVehicleLabel(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
        </label>
        <label className="text-xs text-gray-500 block">
          Immatriculation
          <input value={vehiclePlate} onChange={(e) => setVehiclePlate(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-500 block">
          VIN / N° de châssis
          <input value={vehicleVin} onChange={(e) => setVehicleVin(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
        </label>
        <label className="text-xs text-gray-500 block">
          Kilométrage à l'entrée
          <input type="number" value={vehicleMileageIn} onChange={(e) => setVehicleMileageIn(e.target.value === '' ? '' : Number(e.target.value))} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
        </label>
      </div>
      <label className="text-xs text-gray-500 block">
        Diagnostic / état des lieux à la réception
        <textarea value={diagnostic} onChange={(e) => setDiagnostic(e.target.value)} rows={3} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
      </label>
      <label className="text-xs text-gray-500 block">
        Taux horaire main d'œuvre (FCFA)
        <input type="number" value={laborRate} onChange={(e) => setLaborRate(Number(e.target.value))} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
      </label>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button onClick={handleSubmit} disabled={isPending} className="w-full bg-kf-navy text-white rounded-md py-2.5 text-sm font-medium">
        {isPending ? 'Création...' : "Ouvrir l'ordre de réparation"}
      </button>
    </div>
  );
}
