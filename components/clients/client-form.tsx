'use client';

import { useState, useTransition } from 'react';
import { createClientFull, type CreateClientInput } from '@/lib/clients/actions';

export function ClientForm() {
  const [form, setForm] = useState<CreateClientInput>({
    clientType: 'particulier',
    firstName: '',
    lastName: '',
    companyName: '',
    phone: '',
    whatsapp: '',
    email: '',
    address: '',
    city: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function update<K extends keyof CreateClientInput>(key: K, value: CreateClientInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        await createClientFull(form);
      } catch (e) {
        if (e instanceof Error && e.message === 'NEXT_REDIRECT') throw e;
        setError(e instanceof Error ? e.message : 'Erreur lors de la création');
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg border p-3 space-y-2">
        <div className="flex gap-2">
          {(['particulier', 'entreprise'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => update('clientType', t)}
              className={`flex-1 rounded-md py-1.5 text-sm border ${
                form.clientType === t ? 'bg-kf-navy text-white border-kf-navy' : 'text-gray-600'
              }`}
            >
              {t === 'particulier' ? 'Particulier' : 'Entreprise'}
            </button>
          ))}
        </div>

        {form.clientType === 'entreprise' && (
          <input
            placeholder="Nom de la société"
            value={form.companyName}
            onChange={(e) => update('companyName', e.target.value)}
            className="w-full border rounded-md px-2 py-1.5 text-sm"
          />
        )}
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
        <div className="grid grid-cols-2 gap-2">
          <input
            placeholder="Adresse"
            value={form.address}
            onChange={(e) => update('address', e.target.value)}
            className="border rounded-md px-2 py-1.5 text-sm"
          />
          <input
            placeholder="Ville"
            value={form.city}
            onChange={(e) => update('city', e.target.value)}
            className="border rounded-md px-2 py-1.5 text-sm"
          />
        </div>
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
        {isPending ? 'Création...' : 'Créer ce client'}
      </button>
    </div>
  );
}
