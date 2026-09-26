'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateClientFull, type CreateClientInput } from '@/lib/clients/actions';
import { IconCheck, IconX } from '@/components/icons';

interface Client extends CreateClientInput {
  id: string;
}

export function ClientEditForm({ client }: { client: Client }) {
  const [form, setForm] = useState<CreateClientInput>({
    clientType: client.clientType,
    firstName: client.firstName ?? '',
    lastName: client.lastName ?? '',
    companyName: client.companyName ?? '',
    phone: client.phone ?? '',
    whatsapp: client.whatsapp ?? '',
    email: client.email ?? '',
    address: client.address ?? '',
    city: client.city ?? '',
    notes: client.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function update<K extends keyof CreateClientInput>(key: K, value: CreateClientInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit() {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      try {
        await updateClientFull({ id: client.id, ...form });
        setSuccess(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur lors de la sauvegarde');
      }
    });
  }

  return (
    <div className="card p-4 space-y-3">
      <h2 className="text-sm font-semibold text-kf-navy">Modifier le client</h2>

      <div className="flex gap-2">
        {(['particulier', 'entreprise'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => update('clientType', t)}
            className={`flex-1 rounded-md py-1.5 text-sm border transition-colors ${
              form.clientType === t ? 'bg-kf-navy text-white border-kf-navy' : 'text-gray-600 border-gray-200'
            }`}
          >
            {t === 'particulier' ? 'Particulier' : 'Entreprise'}
          </button>
        ))}
      </div>

      {form.clientType === 'entreprise' && (
        <div>
          <label className="field-label">Nom de la société</label>
          <input
            value={form.companyName}
            onChange={(e) => update('companyName', e.target.value)}
            className="input mt-1"
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">Prénom</label>
          <input value={form.firstName} onChange={(e) => update('firstName', e.target.value)} className="input mt-1" />
        </div>
        <div>
          <label className="field-label">Nom</label>
          <input value={form.lastName} onChange={(e) => update('lastName', e.target.value)} className="input mt-1" />
        </div>
      </div>
      <div>
        <label className="field-label">Téléphone</label>
        <input value={form.phone} onChange={(e) => update('phone', e.target.value)} className="input mt-1" />
      </div>
      <div>
        <label className="field-label">WhatsApp (si différent)</label>
        <input value={form.whatsapp} onChange={(e) => update('whatsapp', e.target.value)} className="input mt-1" />
      </div>
      <div>
        <label className="field-label">Email</label>
        <input
          type="email"
          value={form.email}
          onChange={(e) => update('email', e.target.value)}
          className="input mt-1"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">Adresse</label>
          <input value={form.address} onChange={(e) => update('address', e.target.value)} className="input mt-1" />
        </div>
        <div>
          <label className="field-label">Ville</label>
          <input value={form.city} onChange={(e) => update('city', e.target.value)} className="input mt-1" />
        </div>
      </div>
      <div>
        <label className="field-label">Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => update('notes', e.target.value)}
          className="input mt-1"
          rows={3}
        />
      </div>

      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1">
          <IconX className="w-3.5 h-3.5" /> {error}
        </p>
      )}
      {success && (
        <p className="text-xs text-green-600 flex items-center gap-1">
          <IconCheck className="w-3.5 h-3.5" /> Modifications enregistrées.
        </p>
      )}

      <button type="button" onClick={handleSubmit} disabled={isPending} className="btn-primary w-full">
        {isPending ? 'Enregistrement...' : 'Enregistrer'}
      </button>
    </div>
  );
}
