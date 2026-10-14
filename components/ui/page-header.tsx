import Link from 'next/link';

// En-tête de page : titre, description, actions à droite. Sur téléphone, les
// actions passent sous le titre.
export function PageHeader({
  title,
  description,
  actions,
  back,
  meta,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  meta?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      {back && (
        <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-[13px] text-gray-500 hover:text-kf-navy">
          <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="page-title">{title}</h1>
          {description && <p className="page-subtitle">{description}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-gray-500">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{actions}</div>}
      </div>
    </div>
  );
}
