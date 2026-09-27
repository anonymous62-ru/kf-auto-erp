'use client';

import { useState, useTransition } from 'react';
import { createProspect, type CreateProspectInput, type ProspectSource } from '@/lib/prospects/actions';

const SOURCES: { value: ProspectSource; label: string }[] = [
  { value: 'showroom', label: 'Showroom' },
  { value: 'appel', label: 'Appel téléphonique' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'site_web', label: 'Site web' },
  { value: 'reseaux_sociaux', label: 'Réseaux sociaux' },
  { value: 'recommandation', label: 'Recommandation' },
  { value: 'autre', label: 'Autre' },
];

export function ProspectForm({ vehicles }: { vehicles: { id: string; designation: string }[] }) {
  const [form, setForm] = useState<CreateProspectInput>({
    firstName: '',
    lastName: '',
    phone: '',
    whatsapp: '',
    email: '',
    source: 'showroom',
    vehicleInterestId: '',
    vehicleInterest: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function update<K extends keyof CreateProspectInput>(key: K, value: CreateProspectInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        await createProspect(form);
      } catch (e) {
        if (e instanceof Error && e.message === 'NEXT_REDIRECT') throw e;
        setError(e instanceof Error ? e.message : 'Erreur lors de la création');
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg border p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <input
            placeholder="Prénom"
            value={form.firstName}
            onChange={(e) => update('firstName', e.target.value)}
            className="border rounded-md px-2 py-1.5 text-sm"
          />
          <input
            placeholder="Nom"
            value={form.lastName}
            onChange={(e) => update('lastName', e.target.value)}
            className="border rounded-md px-2 py-1.5 text-sm"
          />
        </div>
        <input
          placeholder="Téléphone"
          value={form.phone}
          onChange={(e) => update('phone', e.target.value)}
          className="w-full border rounded-md px-2 py-1.5 text-sm"
        />
        <input
          placeholder="WhatsApp (si différent)"
          value={form.whatsapp}
          onChange={(e) => update('whatsapp', e.target.value)}
          className="w-full border rounded-md px-2 py-1.5 text-sm"
        />
        <input
          placeholder="Email"
          type="email"
          value={form.email}
          onChange={(e) => update('email', e.target.value)}
          className="w-full border rounded-md px-2 py-1.5 text-sm"
        />

        <label className="text-xs text-gray-500 block">
          Origine du contact
          <select
            value={form.source}
            onChange={(e) => update('source', e.target.value as ProspectSource)}
            className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
          >
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-gray-500 block">
          Véhicule qui l'intéresse (catalogue)
          <select
            value={form.vehicleInterestId}
            onChange={(e) => update('vehicleInterestId', e.target.value)}
            className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
          >
            <option value="">— aucun / pas encore précisé —</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.designation}
              </option>
            ))}
          </select>
        </label>
        <input
          placeholder="Autre véhicule (si hors catalogue)"
          value={form.vehicleInterest}
          onChange={(e) => update('vehicleInterest', e.target.value)}
          className="w-full border rounded-md px-2 py-1.5 text-sm"
        />

        <textarea
          placeholder="Notes (optionnel)"
          value={form.notes}
          onChange={(e) => update('notes', e.target.value)}
          className="w-full border rounded-md px-2 py-1.5 text-sm"
          rows={2}
        />
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={isPending}
        className="w-full bg-kf-navy text-white rounded-md py-3 text-sm font-medium disabled:opacity-50"
      >
        {isPending ? 'Création...' : 'Créer ce prospect'}
      </button>
    </div>
  );
}
