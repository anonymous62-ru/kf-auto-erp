'use client';

import { useState, useTransition } from 'react';
import { setMonthlyTarget } from '@/lib/organization/actions';

function format(n: number) {
  return new Intl.NumberFormat('fr-FR').format(n).replace(/[  ]/g, ' ');
}

// Objectif mensuel de ventes affiché sur le compte-tours du tableau de bord.
export function MonthlyTargetForm({ initial }: { initial: number }) {
  const [value, setValue] = useState(initial ? format(initial) : '');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const amount = Number(value.replace(/[^\d]/g, '')) || 0;

  return (
    <section className="card space-y-3 p-4">
      <div>
        <p className="section-title">Objectif mensuel</p>
        <p className="mt-0.5 text-[13px] text-gray-500">
          Montant facturé visé chaque mois, toutes ventes confondues. Il alimente le compte-tours du tableau de bord.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="block sm:w-64">
          <span className="field-label">Montant (FCFA)</span>
          <input
            className="input text-right tabular-nums"
            inputMode="numeric"
            value={value}
            onChange={(e) => {
              setSaved(false);
              const digits = e.target.value.replace(/[^\d]/g, '');
              setValue(digits ? format(Number(digits)) : '');
            }}
            placeholder="150 000 000"
          />
        </label>
        <button
          type="button"
          disabled={isPending}
          className="btn-primary"
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await setMonthlyTarget(amount);
              if (result.error) setError(result.error);
              else setSaved(true);
            })
          }
        >
          {isPending ? 'Enregistrement...' : 'Enregistrer'}
        </button>
        {saved && <span className="text-[13px] text-emerald-700">Objectif enregistré</span>}
      </div>
      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}
