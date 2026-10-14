import Link from 'next/link';

// État vide : texte explicatif et action principale.
export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description?: React.ReactNode;
  action?: { href: string; label: string } | React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center text-center ${compact ? 'px-4 py-6' : 'px-6 py-12'}`}>
      <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-gray-300" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3.5 9.5h17M8 14h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <p className="mt-3 text-sm font-medium text-[#1f2937]">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-gray-500">{description}</p>}
      {action && (
        <div className="mt-4">
          {typeof action === 'object' && action !== null && 'href' in (action as object) ? (
            <Link href={(action as { href: string }).href} className="btn-primary">
              {(action as { label: string }).label}
            </Link>
          ) : (
            (action as React.ReactNode)
          )}
        </div>
      )}
    </div>
  );
}
