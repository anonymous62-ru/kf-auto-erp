import Link from 'next/link';
import { PERIOD_FILTERS, type PeriodFilterKey } from '@/lib/objectives/periods';

// Filtre de période par liens (?periode=...), sans JavaScript côté client.
export function PeriodFilter({
  basePath,
  active,
  param = 'periode',
  hash,
}: {
  basePath: string;
  active: PeriodFilterKey;
  param?: string;
  hash?: string;
}) {
  return (
    <nav className="flex flex-wrap gap-1.5" aria-label="Période">
      {PERIOD_FILTERS.map((f) => (
        <Link
          key={f.key}
          href={`${basePath}${f.key === 'mois' ? '' : `?${param}=${f.key}`}${hash ? `#${hash}` : ''}`}
          scroll={false}
          className={`chip ${active === f.key ? 'chip-active' : ''}`}
          aria-current={active === f.key ? 'true' : undefined}
        >
          {f.label}
        </Link>
      ))}
    </nav>
  );
}
