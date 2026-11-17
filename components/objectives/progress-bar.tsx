// Barre de progression sobre (aplat, sans dégradé) : bleu nuit en cours,
// vert une fois l'objectif atteint.
export function ProgressBar({ pct, label }: { pct: number; label?: string }) {
  const width = Math.max(0, Math.min(100, pct));
  const done = pct >= 100;
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-sm bg-trait-2"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(pct, 100)}
      aria-label={label}
    >
      <div className={`h-full rounded-sm ${done ? 'bg-[#12804F]' : 'bg-nuit'}`} style={{ width: `${width}%` }} />
    </div>
  );
}
