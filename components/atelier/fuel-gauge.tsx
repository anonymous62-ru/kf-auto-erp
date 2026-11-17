'use client';

import { fuelLabel } from '@/lib/atelier/inspection-config';

// Jauge de carburant en huitièmes : 9 crans cliquables (Vide à Plein),
// graduée Vide, 1/4, 1/2, 3/4, Plein comme sur un tableau de bord.
export function FuelGauge({
  value,
  onChange,
  readOnly = false,
  compact = false,
}: {
  value: number | null;
  onChange?: (v: number | null) => void;
  readOnly?: boolean;
  compact?: boolean;
}) {
  const steps = Array.from({ length: 9 }, (_, i) => i);
  const h = compact ? 'h-4' : 'h-11';

  return (
    <div className="space-y-1">
      <div className="flex items-end gap-1" role={readOnly ? undefined : 'radiogroup'} aria-label="Niveau de carburant">
        {steps.map((i) => {
          const filled = value !== null && i <= value;
          const color =
            value === null ? 'bg-trait-2' : filled ? (value <= 1 ? 'bg-rouge' : value <= 2 ? 'bg-[#D98A1C]' : 'bg-nuit') : 'bg-trait-2';
          if (readOnly) {
            return <span key={i} className={`flex-1 rounded-sm ${h} ${color}`} />;
          }
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={value === i}
              aria-label={fuelLabel(i)}
              onClick={() => onChange?.(value === i ? null : i)}
              className={`flex-1 rounded ${h} ${color} border border-white focus:outline-none focus-visible:ring-2 focus-visible:ring-nuit`}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-5 text-[11px] text-encre-3">
        <span>Vide</span>
        <span className="text-center">1/4</span>
        <span className="text-center">1/2</span>
        <span className="text-center">3/4</span>
        <span className="text-right">Plein</span>
      </div>
      {!compact && (
        <p className="text-sm font-medium text-encre">
          Niveau : {fuelLabel(value)}
          {!readOnly && value !== null && <span className="text-xs text-encre-3 font-normal"> (touchez à nouveau pour effacer)</span>}
        </p>
      )}
    </div>
  );
}
