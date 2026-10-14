import Link from 'next/link';

// Onglets en liens (?onglet=...) : fonctionnent sans JavaScript et gardent
// l'onglet dans l'adresse.
export function Tabs({
  tabs,
  active,
  basePath,
  param = 'onglet',
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  basePath: string;
  param?: string;
}) {
  return (
    <nav className="tabs mb-4" aria-label="Sections">
      {tabs.map((t, i) => (
        <Link
          key={t.key}
          href={i === 0 ? basePath : `${basePath}?${param}=${t.key}`}
          scroll={false}
          aria-current={active === t.key ? 'page' : undefined}
          className={`tab ${active === t.key ? 'tab-active' : ''}`}
        >
          {t.label}
          {typeof t.count === 'number' && <span className="num ml-1.5 text-xs text-gray-400">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
