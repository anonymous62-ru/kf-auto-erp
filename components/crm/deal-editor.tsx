'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { removeDeal, updateDeal } from '@/lib/crm/deals';
import { DEAL_STAGES, TEMPERATURES, type DealStage, type Temperature } from '@/lib/crm/labels';

// Mise à jour rapide d'une affaire : température, étape, montant, date,
// document rattaché, notes. "Commande passée" et "Gagnée" se posent aussi
// automatiquement par le circuit de vente.
export function DealEditor({
  deal,
  documents,
  canEdit,
  canRemove,
}: {
  deal: {
    id: string;
    temperature: Temperature;
    stage: DealStage;
    estimated_amount: number;
    expected_close_date: string | null;
    notes: string | null;
    lost_reason: string | null;
    document_id: string | null;
  };
  documents: { id: string; label: string }[];
  canEdit: boolean;
  canRemove: boolean;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(deal.estimated_amount || ''));
  const [closeDate, setCloseDate] = useState(deal.expected_close_date ?? '');
  const [notes, setNotes] = useState(deal.notes ?? '');
  const [lostReason, setLostReason] = useState(deal.lost_reason ?? '');
  const [askLost, setAskLost] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function run(patch: Parameters<typeof updateDeal>[1]) {
    if (isPending) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const r = await updateDeal(deal.id, patch);
      if (r.error) setError(r.error);
      else {
        setSaved(true);
        setAskLost(false);
        router.refresh();
      }
    });
  }

  if (!canEdit) return null;

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-900">Température</p>
        <div className="flex gap-2">
          {TEMPERATURES.map((t) => (
            <button
              key={t.value}
              type="button"
              disabled={isPending}
              onClick={() => run({ temperature: t.value })}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md border py-2 text-sm ${
                deal.temperature === t.value ? 'border-kf-navy bg-kf-navy text-white' : 'border-gray-200 text-gray-700'
              }`}
            >
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${t.dot}`} /> {t.label}
            </button>
          ))}
        </div>
        <p className="text-sm font-semibold text-gray-900 pt-1">Étape</p>
        <div className="flex flex-wrap gap-1.5">
          {DEAL_STAGES.map((s) => (
            <button
              key={s.value}
              type="button"
              disabled={isPending}
              onClick={() => (s.value === 'perdue' ? setAskLost(true) : run({ stage: s.value }))}
              className={`rounded-md border px-2.5 py-1.5 text-xs ${
                deal.stage === s.value ? 'border-kf-navy bg-kf-navy text-white' : 'border-gray-200 text-gray-700'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {askLost && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              placeholder="Pourquoi ? (prix, concurrent, financement, plus de nouvelles...)"
              className="input"
            />
            <button type="button" onClick={() => run({ stage: 'perdue', lostReason })} className="btn-secondary shrink-0">
              Marquer perdue
            </button>
          </div>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-gray-500">
            Montant estimé (FCFA)
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} className="input mt-1" />
          </label>
          <label className="block text-xs text-gray-500">
            Conclusion prévue le
            <input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} className="input mt-1" />
          </label>
        </div>
        <label className="block text-xs text-gray-500">
          Document rattaché
          <select
            value={deal.document_id ?? ''}
            onChange={(e) => run({ documentId: e.target.value || null, ...(e.target.value && deal.stage === 'decouverte' ? { stage: 'proforma' } : {}) })}
            className="input mt-1"
            disabled={isPending}
          >
            <option value="">Aucun</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-gray-500">
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="input mt-1" />
        </label>
        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {saved && <p className="text-sm text-green-700">Enregistré.</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => run({ estimatedAmount: Number(amount) || 0, expectedCloseDate: closeDate || null, notes })}
            className="btn-primary"
          >
            Enregistrer
          </button>
          {canRemove && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                if (!confirm('Supprimer définitivement cette affaire ?')) return;
                startTransition(async () => {
                  const r = await removeDeal(deal.id);
                  if (r?.error) setError(r.error);
                });
              }}
              className="btn-secondary text-red-700"
            >
              Supprimer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
