'use client';

import {
  MAX_INSTALLMENTS,
  buildEqualSchedule,
  formatFCFA,
  scheduleTotal,
  type InstallmentInput,
} from '@/lib/payments/schedule';

// Saisie de l'échéancier : nombre d'échéances, puis montant et date de
// chacune (pré-remplies : parts égales arrondies au franc, mensuelles),
// avec le contrôle en direct du total par rapport au reste à échelonner.
export function ScheduleEditor({
  remaining,
  startDate,
  minDate,
  rows,
  onChange,
  disabled,
}: {
  remaining: number;
  startDate: string;
  minDate: string;
  rows: InstallmentInput[];
  onChange: (rows: InstallmentInput[]) => void;
  disabled?: boolean;
}) {
  const total = scheduleTotal(rows);
  const target = Math.round(remaining);
  const diff = Math.round(target - total);
  const balanced = Math.abs(remaining - total) < 1;

  function setCount(n: number) {
    onChange(buildEqualSchedule(remaining, n, startDate));
  }

  function update(i: number, patch: Partial<InstallmentInput>) {
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-2">
      <label className="text-xs text-gray-500 block">
        Nombre d&apos;échéances
        <select
          value={rows.length}
          disabled={disabled}
          onChange={(e) => setCount(Number(e.target.value))}
          className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
        >
          {Array.from({ length: MAX_INSTALLMENTS }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[2rem_1fr_1fr] items-end gap-2">
            <span className="pb-2 text-xs text-gray-500 tabular-nums">{i + 1}.</span>
            <label className="text-xs text-gray-500 block">
              Montant (F CFA)
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={Number.isFinite(r.amount) ? r.amount : ''}
                disabled={disabled}
                onChange={(e) => update(i, { amount: e.target.value === '' ? NaN : Math.round(Number(e.target.value)) })}
                className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5 tabular-nums"
              />
            </label>
            <label className="text-xs text-gray-500 block">
              Date
              <input
                type="date"
                min={minDate}
                value={r.dueDate}
                disabled={disabled}
                onChange={(e) => update(i, { dueDate: e.target.value })}
                className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
              />
            </label>
          </div>
        ))}
      </div>

      <div className={`rounded-md px-2 py-1.5 text-xs ${balanced ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
        Total des échéances : <strong className="tabular-nums">{formatFCFA(total)}</strong> / Reste à échelonner :{' '}
        <strong className="tabular-nums">{formatFCFA(target)}</strong>
        {!balanced && (
          <span className="block">
            {diff > 0 ? `Il manque ${formatFCFA(diff)}.` : `Dépassement de ${formatFCFA(-diff)}.`}
          </span>
        )}
      </div>
    </div>
  );
}
