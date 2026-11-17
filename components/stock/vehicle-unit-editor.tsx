'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { removeVehicleUnit, updateVehicleUnit } from '@/lib/stock/actions';
import { MANUAL_STATUSES, VEHICLE_STATUS, VEHICLE_STATUS_ORDER, type VehicleStatus } from '@/lib/stock/labels';

type Unit = {
  id: string;
  product_id: string;
  vin: string;
  engine_number: string | null;
  color: string | null;
  model_year: number | null;
  entry_date: string;
  location: string | null;
  notes: string | null;
  status: VehicleStatus;
};

// Modification d'un véhicule du stock : modèle, châssis, moteur, couleur,
// année, date d'entrée, emplacement, statut, remarques. "Réservé" et
// "Vendu" suivent le circuit de vente : seule la direction les pose ou les
// retire à la main (la base le vérifie aussi). Suppression possible
// seulement pour un véhicule libre, jamais lié à un document.
export function VehicleUnitEditor({
  unit,
  products,
  isDirection,
  linkedToDocument,
}: {
  unit: Unit;
  products: { id: string; designation: string }[];
  isDirection: boolean;
  linkedToDocument: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    productId: unit.product_id,
    vin: unit.vin,
    engineNumber: unit.engine_number ?? '',
    color: unit.color ?? '',
    modelYear: unit.model_year ? String(unit.model_year) : '',
    entryDate: unit.entry_date,
    location: unit.location ?? '',
    notes: unit.notes ?? '',
    status: unit.status,
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Anti double clic : verrou posé avant la transition (isPending arrive un
  // rendu plus tard).
  const busy = useRef(false);

  const salesLocked = unit.status === 'reserve' || unit.status === 'vendu';
  const statusLocked = !isDirection && salesLocked;
  const statuses = isDirection ? VEHICLE_STATUS_ORDER : MANUAL_STATUSES;
  const modelLocked = !isDirection && linkedToDocument;
  const canRemove = !linkedToDocument && !salesLocked;

  function run(task: () => Promise<void>) {
    if (busy.current || isPending) return;
    busy.current = true;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await task();
      } finally {
        busy.current = false;
      }
    });
  }

  function save() {
    run(async () => {
      const r = await updateVehicleUnit({
        id: unit.id,
        productId: form.productId !== unit.product_id ? form.productId : undefined,
        vin: form.vin,
        engineNumber: form.engineNumber,
        color: form.color,
        modelYear: form.modelYear ? Number(form.modelYear) : null,
        entryDate: form.entryDate,
        location: form.location,
        notes: form.notes,
        status: form.status !== unit.status ? form.status : undefined,
      });
      if (r.error) setError(r.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  function remove() {
    run(async () => {
      const r = await removeVehicleUnit(unit.id);
      if (r.error) {
        setError(r.error);
        setConfirmRemove(false);
      } else {
        router.push('/stock');
        router.refresh();
      }
    });
  }

  const set =
    (k: Exclude<keyof typeof form, 'status'>) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div id="modifier" className="card p-4 space-y-3 scroll-mt-20">
      <p className="text-sm font-semibold text-gray-900">Modifier ce véhicule</p>

      <label className="block text-xs text-gray-500">
        Modèle
        <select value={form.productId} onChange={set('productId')} disabled={modelLocked} className="input mt-1">
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.designation}
            </option>
          ))}
        </select>
        {modelLocked && (
          <span className="mt-1 block text-gray-500">Ce véhicule figure sur un document : seule la direction peut changer son modèle.</span>
        )}
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-gray-500">
          Numéro de châssis
          <input value={form.vin} onChange={set('vin')} className="input mt-1 font-mono" />
        </label>
        <label className="block text-xs text-gray-500">
          Numéro moteur
          <input value={form.engineNumber} onChange={set('engineNumber')} className="input mt-1 font-mono" />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs text-gray-500">
          Couleur
          <input value={form.color} onChange={set('color')} className="input mt-1" />
        </label>
        <label className="block text-xs text-gray-500">
          Année modèle
          <input
            value={form.modelYear}
            onChange={(e) => setForm((f) => ({ ...f, modelYear: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
            inputMode="numeric"
            className="input mt-1"
          />
        </label>
        <label className="block text-xs text-gray-500">
          Date d&apos;entrée en stock
          <input type="date" value={form.entryDate} onChange={set('entryDate')} className="input mt-1" />
        </label>
      </div>
      <label className="block text-xs text-gray-500">
        Emplacement
        <input value={form.location} onChange={set('location')} placeholder="Showroom Sagbado, parc..." className="input mt-1" />
      </label>

      <div className="space-y-1.5">
        <p className="text-xs text-gray-500">Statut</p>
        {statusLocked ? (
          <p className="text-sm text-gray-600">
            {VEHICLE_STATUS[unit.status].label} : ce statut suit {unit.status === 'vendu' ? 'la facture' : "l'acompte de la facture"}.
            Seule la direction peut le corriger.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {statuses.map((s) => (
              <button
                key={s}
                type="button"
                disabled={isPending}
                onClick={() => setForm((f) => ({ ...f, status: s }))}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  form.status === s ? 'border-kf-navy bg-kf-navy text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {VEHICLE_STATUS[s].label}
              </button>
            ))}
          </div>
        )}
      </div>

      <label className="block text-xs text-gray-500">
        Remarques (dommages, essais prévus...)
        <textarea value={form.notes} onChange={set('notes')} rows={3} className="input mt-1" />
      </label>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {saved && <p className="text-sm text-green-700">Modifications enregistrées.</p>}

      <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
        <button type="button" onClick={save} disabled={isPending} className="btn-primary">
          {isPending ? 'Enregistrement...' : 'Enregistrer'}
        </button>
        {canRemove &&
          (confirmRemove ? (
            <>
              <span className="text-sm text-gray-700">Supprimer ce véhicule du stock ?</span>
              <button type="button" onClick={remove} disabled={isPending} className="btn-danger">
                {isPending ? 'Suppression...' : 'Oui, supprimer'}
              </button>
              <button type="button" onClick={() => setConfirmRemove(false)} disabled={isPending} className="btn-secondary">
                Annuler
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmRemove(true)} disabled={isPending} className="btn-danger-ghost">
              Supprimer (saisi par erreur)
            </button>
          ))}
      </div>
      {!canRemove && (
        <p className="text-xs text-gray-500">
          Suppression impossible : ce véhicule {salesLocked ? 'est réservé ou vendu' : 'figure sur un document'}.
        </p>
      )}
    </div>
  );
}
