'use client';

import { useState, useTransition } from 'react';
import { createCampaign, updateCampaign, type CampaignInput } from '@/lib/crm/campaigns';
import { CAMPAIGN_STATUS, CHANNELS } from '@/lib/crm/labels';
import { formatCFA } from '@/lib/documents/calculations';

export function CampaignForm({ campaignId, initial }: { campaignId?: string; initial?: CampaignInput }) {
  const [form, setForm] = useState<CampaignInput>(
    initial ?? {
      name: '',
      channel: 'facebook',
      startDate: new Date().toISOString().slice(0, 10),
      endDate: '',
      budget: 0,
      spent: 0,
      objective: '',
      status: 'preparation',
      notes: '',
    }
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const set = <K extends keyof CampaignInput>(k: K, v: CampaignInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    if (isPending) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const r = campaignId ? await updateCampaign(campaignId, form) : await createCampaign(form);
      if (r?.error) setError(r.error);
      else setSaved(true);
    });
  }

  return (
    <div className="card p-4 space-y-3 max-w-2xl">
      <label className="block text-xs text-gray-500">
        Nom de la campagne
        <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex. : Lancement Tiggo 9 - octobre" className="input mt-1" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-gray-500">
          Canal
          <select value={form.channel} onChange={(e) => set('channel', e.target.value)} className="input mt-1">
            {CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-gray-500">
          Statut
          <select value={form.status} onChange={(e) => set('status', e.target.value)} className="input mt-1">
            {CAMPAIGN_STATUS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-gray-500">
          Début
          <input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} className="input mt-1" />
        </label>
        <label className="block text-xs text-gray-500">
          Fin (optionnel)
          <input type="date" value={form.endDate ?? ''} onChange={(e) => set('endDate', e.target.value)} className="input mt-1" />
        </label>
        <label className="block text-xs text-gray-500">
          Budget prévu (FCFA)
          <input
            inputMode="numeric"
            value={form.budget ? String(form.budget) : ''}
            onChange={(e) => set('budget', Number(e.target.value.replace(/\D/g, '')) || 0)}
            className="input mt-1"
          />
          {form.budget > 0 && <span className="mt-1 block text-gray-400">{formatCFA(form.budget)}</span>}
        </label>
        <label className="block text-xs text-gray-500">
          Déjà dépensé (FCFA)
          <input
            inputMode="numeric"
            value={form.spent ? String(form.spent) : ''}
            onChange={(e) => set('spent', Number(e.target.value.replace(/\D/g, '')) || 0)}
            className="input mt-1"
          />
          {form.spent > 0 && <span className="mt-1 block text-gray-400">{formatCFA(form.spent)}</span>}
        </label>
      </div>
      <label className="block text-xs text-gray-500">
        Objectif (optionnel)
        <input value={form.objective ?? ''} onChange={(e) => set('objective', e.target.value)} placeholder="Ex. : 50 leads, 5 essais" className="input mt-1" />
      </label>
      <label className="block text-xs text-gray-500">
        Notes
        <textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} rows={3} className="input mt-1" />
      </label>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {saved && <p className="text-sm text-green-700">Enregistré.</p>}
      <button type="button" onClick={submit} disabled={isPending} className="btn-primary">
        {isPending ? 'Enregistrement...' : campaignId ? 'Enregistrer' : 'Créer la campagne'}
      </button>
    </div>
  );
}
