'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateProspect, type ProspectSource } from '@/lib/prospects/actions';

const SOURCES: { value: ProspectSource; label: string }[] = [
  { value: 'showroom', label: 'Showroom' },
  { value: 'appel', label: 'Appel téléphonique' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'site_web', label: 'Site web' },
  { value: 'reseaux_sociaux', label: 'Réseaux sociaux' },
  { value: 'recommandation', label: 'Recommandation' },
  { value: 'autre', label: 'Autre' },
];

export function ProspectEditForm({
  prospect,
  vehicles,
}: {
  prospect: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    company_name?: string | null;
    contact_name?: string | null;
    sector?: string | null;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
    source: ProspectSource | null;
    vehicle_interest_id: string | null;
    vehicle_interest: string | null;
    notes: string | null;
  };
  vehicles: { id: string; designation: string }[];
}) {
  const [form, setForm] = useState({
    companyName: prospect.company_name ?? '',
    contactName: prospect.contact_name ?? '',
    sector: prospect.sector ?? '',
    firstName: prospect.first_name ?? '',
    lastName: prospect.last_name ?? '',
    phone: prospect.phone ?? '',
    whatsapp: prospect.whatsapp ?? '',
    email: prospect.email ?? '',
    source: (prospect.source ?? 'autre') as ProspectSource,
    vehicleInterestId: prospect.vehicle_interest_id ?? '',
    vehicleInterest: prospect.vehicle_interest ?? '',
    notes: prospect.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        await updateProspect({ id: prospect.id, ...form });
        router.push(`/prospects/${prospect.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur lors de la mise à jour');
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg border p-3 space-y-2">
        <input
          placeholder="Entreprise (si client professionnel)"
          value={form.companyName}
          onChange={(e) => update('companyName', e.target.value)}
          className="w-full border rounded-md px-2 py-1.5 text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            placeholder="Personne à contacter, fonction"
            value={form.contactName}
            onChange={(e) => update('contactName', e.target.value)}
            className="border rounded-md px-2 py-1.5 text-sm"
          />
          <input
            placeholder="Secteur d'activité"
            value={form.sector}
            onChange={(e) => update('sector', e.target.value)}
            className="border rounded-md px-2 py-1.5 text-sm"
          />
        </div>
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
          placeholder="Notes"
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
        {isPending ? 'Enregistrement...' : 'Enregistrer les modifications'}
      </button>
    </div>
  );
}
