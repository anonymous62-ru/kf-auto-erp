import Link from 'next/link';

export const PAGE_SIZE = 25;

export function pageFromParam(value: string | undefined) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

// Pagination : « 1-25 sur 132 », précédent / suivant.
export function Pagination({
  page,
  total,
  pageSize = PAGE_SIZE,
  hrefFor,
}: {
  page: number;
  total: number;
  pageSize?: number;
  hrefFor: (page: number) => string;
}) {
  if (total <= pageSize && page === 1) {
    return total > 0 ? <p className="num px-3 py-2.5 text-xs text-gray-500">{total} résultat{total > 1 ? 's' : ''}</p> : null;
  }
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-3 py-2.5 text-xs text-gray-500">
      <p className="num">
        {from}-{to} sur {total}
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className="btn-secondary btn-sm">
            Précédent
          </Link>
        ) : (
          <span className="btn-secondary btn-sm pointer-events-none opacity-40">Précédent</span>
        )}
        <span className="num px-2">
          {page} / {pages}
        </span>
        {page < pages ? (
          <Link href={hrefFor(page + 1)} className="btn-secondary btn-sm">
            Suivant
          </Link>
        ) : (
          <span className="btn-secondary btn-sm pointer-events-none opacity-40">Suivant</span>
        )}
      </div>
    </div>
  );
}

// En-tête de colonne triable : clic = tri croissant, second clic = décroissant.
export function SortHeader({
  label,
  column,
  sort,
  dir,
  hrefFor,
  align = 'left',
}: {
  label: string;
  column: string;
  sort: string;
  dir: 'asc' | 'desc';
  hrefFor: (column: string, dir: 'asc' | 'desc') => string;
  align?: 'left' | 'right';
}) {
  const active = sort === column;
  const nextDir = active && dir === 'desc' ? 'asc' : 'desc';
  return (
    <th className={align === 'right' ? 'num' : undefined} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Link href={hrefFor(column, nextDir)} className={`inline-flex items-center gap-1 hover:text-[#1f2937] ${active ? 'text-[#1f2937]' : ''}`}>
        {label}
        <svg viewBox="0 0 12 12" className={`h-3 w-3 ${active ? '' : 'opacity-30'}`} aria-hidden="true">
          {active && dir === 'asc' ? (
            <path d="M3 7.5 6 4.5l3 3" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M3 4.5 6 7.5l3-3" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
      </Link>
    </th>
  );
}
