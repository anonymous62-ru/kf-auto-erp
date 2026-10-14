import Link from 'next/link';

// Carte de statistique : chiffre, libellé, variation par rapport à la
// période précédente. La variation n'est affichée que si elle est calculable
// (jamais de chiffre inventé).
export function StatCard({
  label,
  value,
  previous,
  current,
  hint,
  href,
  invert = false,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  current?: number | null;
  previous?: number | null;
  hint?: React.ReactNode;
  href?: string;
  // true quand une hausse est une mauvaise nouvelle (impayés, retards).
  invert?: boolean;
  tone?: 'alert';
}) {
  let delta: { text: string; good: boolean | null } | null = null;
  if (typeof current === 'number' && typeof previous === 'number') {
    if (previous === 0 && current === 0) delta = { text: '0 %', good: null };
    else if (previous === 0) delta = { text: 'nouveau', good: invert ? false : true };
    else {
      const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
      delta = { text: `${pct > 0 ? '+' : ''}${pct} %`, good: pct === 0 ? null : invert ? pct < 0 : pct > 0 };
    }
  }
  const body = (
    <>
      <p className="text-[13px] text-gray-500">{label}</p>
      <p className={`num mt-1 text-2xl font-semibold tracking-tight ${tone === 'alert' ? 'text-kf-red' : 'text-[#1f2937]'}`}>{value}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
        {delta && (
          <span
            className={`num font-medium ${
              delta.good === null ? 'text-gray-500' : delta.good ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {delta.text}
          </span>
        )}
        {delta && <span>vs période précédente</span>}
        {hint && <span>{hint}</span>}
      </div>
    </>
  );
  return href ? (
    <Link href={href} className="card card-hover block p-4">
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}
