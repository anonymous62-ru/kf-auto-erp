'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createAppointment } from '@/lib/atelier/actions';

export function NewAppointmentForm({ clients }: { clients: { id: string; label: string }[] }) {
  const [clientId, setClientId] = useState('');
  const [vehicleLabel, setVehicleLabel] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleVin, setVehicleVin] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    setError(null);
    if (!scheduledAt) {
      setError('Choisissez une date et une heure');
      return;
    }
    startTransition(async () => {
      try {
        await createAppointment({
          clientId: clientId || undefined,
          vehicleLabel: vehicleLabel || undefined,
          vehiclePlate: vehiclePlate || undefined,
          vehicleVin: vehicleVin || undefined,
          scheduledAt: new Date(scheduledAt).toISOString(),
          reason: reason || undefined,
        });
        router.push('/atelier');
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
      <label className="text-xs text-gray-500 block">
        VIN / N° de châssis (optionnel)
        <input value={vehicleVin} onChange={(e) => setVehicleVin(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
      </label>
      <label className="text-xs text-gray-500 block">
        Date et heure du rendez-vous
        <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
      </label>
      <label className="text-xs text-gray-500 block">
        Motif
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Vidange, bruit moteur, entretien 10 000 km..." className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5" />
      </label>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button onClick={handleSubmit} disabled={isPending} className="w-full bg-kf-navy text-white rounded-md py-2.5 text-sm font-medium">
        {isPending ? 'Enregistrement...' : 'Planifier le rendez-vous'}
      </button>
    </div>
  );
}
