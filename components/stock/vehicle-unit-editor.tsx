'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setVehicleStatus, updateVehicleUnit } from '@/lib/stock/actions';
import { MANUAL_STATUSES, VEHICLE_STATUS, VEHICLE_STATUS_ORDER, type VehicleStatus } from '@/lib/stock/labels';

type Unit = {
  id: string;
  vin: string;
  color: string | null;
  model_year: number | null;
  entry_date: string;
  location: string | null;
  notes: string | null;
  status: VehicleStatus;
};

// Fiche véhicule : changement de statut et correction des informations.
// "Réservé" et "Vendu" suivent les paiements ; seule la direction peut les
// poser ou les retirer à la main (correction).
export function VehicleUnitEditor({ unit, isDirection }: { unit: Unit; isDirection: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({
    vin: unit.vin,
    color: unit.color ?? '',
    modelYear: unit.model_year ? String(unit.model_year) : '',
    entryDate: unit.entry_date,
    location: unit.location ?? '',
    notes: unit.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const locked = !isDirection && (unit.status === 'reserve' || unit.status === 'vendu');
  const statuses = isDirection ? VEHICLE_STATUS_ORDER : MANUAL_STATUSES;

  function changeStatus(status: VehicleStatus) {
    if (isPending || status === unit.status) return;
    setError(null);
    startTransition(async () => {
      const r = await setVehicleStatus(unit.id, status);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  }

  function save() {
    if (isPending) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const r = await updateVehicleUnit({
        id: unit.id,
        vin: form.vin,
        color: form.color,
        modelYear: form.modelYear ? Number(form.modelYear) : null,
        entryDate: form.entryDate,
        location: form.location,
        notes: form.notes,
      });
      if (r.error) setError(r.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-2">
        <p className="text-sm font-semibold text-gray-900">Statut</p>
        {locked ? (
          <p className="text-sm text-gray-600">
            Ce véhicule est {unit.status === 'vendu' ? 'vendu' : 'réservé par un acompte'} : son statut suit la facture. Seule
            la direction peut le corriger.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {statuses.map((s) => (
              <button
                key={s}
                type="button"
                disabled={isPending}
                onClick={() => changeStatus(s)}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  unit.status === s ? 'border-kf-navy bg-kf-navy text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {VEHICLE_STATUS[s].label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-900">Informations</p>
        <label className="block text-xs text-gray-500">
          Numéro de châssis
          <input value={form.vin} onChange={set('vin')} className="input mt-1 font-mono" />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-xs text-gray-500">
            Date d&apos;entrée en stock
            <input type="date" value={form.entryDate} onChange={set('entryDate')} className="input mt-1" />
          </label>
          <label className="block text-xs text-gray-500">
            Couleur
            <input value={form.color} onChange={set('color')} className="input mt-1" />
          </label>
          <label className="block text-xs text-gray-500">
            Année modèle
            <input value={form.modelYear} onChange={set('modelYear')} inputMode="numeric" className="input mt-1" />
          </label>
        </div>
        <label className="block text-xs text-gray-500">
          Emplacement
          <input value={form.location} onChange={set('location')} className="input mt-1" />
        </label>
        <label className="block text-xs text-gray-500">
          Remarques (dommages, essais prévus...)
          <textarea value={form.notes} onChange={set('notes')} rows={3} className="input mt-1" />
        </label>
        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {saved && <p className="text-sm text-green-700">Modifications enregistrées.</p>}
        <button type="button" onClick={save} disabled={isPending} className="btn-primary">
          {isPending ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
