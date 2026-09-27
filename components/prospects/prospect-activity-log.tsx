'use client';

import { useState, useTransition } from 'react';
import { addProspectActivity, type ActivityType } from '@/lib/prospects/actions';
import { useRouter } from 'next/navigation';

const TYPES: { value: ActivityType; label: string }[] = [
  { value: 'appel', label: 'Appel' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
  { value: 'visite', label: 'Visite' },
  { value: 'relance', label: 'Relance' },
  { value: 'autre', label: 'Autre' },
];

type Activity = { id: string; activity_type: ActivityType; notes: string | null; created_at: string };

export function ProspectActivityLog({ prospectId, activities }: { prospectId: string; activities: Activity[] }) {
  const [type, setType] = useState<ActivityType>('appel');
  const [notes, setNotes] = useState('');
  const [nextRelanceAt, setNextRelanceAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        await addProspectActivity({
          prospectId,
          activityType: type,
          notes: notes || undefined,
          nextRelanceAt: nextRelanceAt ? new Date(nextRelanceAt).toISOString() : undefined,
        });
        setNotes('');
        setNextRelanceAt('');
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur');
      }
    });
  }

  return (
    <div className="card p-4 space-y-3">
      <h2 className="text-sm font-semibold text-kf-navy">Relances / contacts</h2>

      <div className="space-y-2 bg-gray-50 rounded-md p-2.5">
        <div className="flex gap-1.5 flex-wrap">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setType(t.value)}
              className={`text-xs px-2.5 py-1 rounded-full border ${
                type === t.value ? 'bg-kf-navy text-white border-kf-navy' : 'text-gray-600 border-gray-200 bg-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <textarea
          placeholder="Ce qui s'est dit / résultat du contact"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full border rounded-md px-2 py-1.5 text-sm"
          rows={2}
        />
        <label className="text-xs text-gray-500 block">
          Prochaine relance prévue (optionnel)
          <input
            type="datetime-local"
            value={nextRelanceAt}
            onChange={(e) => setNextRelanceAt(e.target.value)}
            className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
          />
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="w-full bg-kf-navy text-white rounded-md py-2 text-sm font-medium disabled:opacity-50"
        >
          {isPending ? 'Enregistrement...' : 'Enregistrer ce contact'}
        </button>
      </div>

      <div className="space-y-2">
        {activities.length === 0 && <p className="text-xs text-gray-400">Aucun contact enregistré pour l'instant.</p>}
        {activities.map((a) => (
          <div key={a.id} className="text-sm border-l-2 border-kf-navy/20 pl-2.5">
            <p className="text-xs text-gray-400">
              {TYPES.find((t) => t.value === a.activity_type)?.label ?? a.activity_type} ·{' '}
              {new Date(a.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
            </p>
            {a.notes && <p className="text-gray-700">{a.notes}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
