import Link from 'next/link';

// Bascule Grille / Liste (paramètre ?vue=).
export function ViewToggle({ view, hrefFor }: { view: 'grille' | 'liste'; hrefFor: (v: 'grille' | 'liste') => string }) {
  const item = (v: 'grille' | 'liste', label: string, icon: React.ReactNode) => (
    <Link
      href={hrefFor(v)}
      aria-current={view === v ? 'page' : undefined}
      className={`inline-flex h-8 items-center gap-1.5 px-2.5 text-[13px] ${
        view === v ? 'bg-kf-navy text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
      }`}
    >
      {icon}
      {label}
    </Link>
  );
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
      {item(
        'grille',
        'Grille',
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
          <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
          <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
          <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
          <rect x="9" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      )}
      <span className="w-px bg-gray-300" />
      {item(
        'liste',
        'Liste',
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}
