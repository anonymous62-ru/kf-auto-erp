'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavGroup, NavIconName } from '@/lib/navigation';
import { LogoutButton } from '@/components/auth/logout-button';
import {
  IconHome,
  IconDocument,
  IconUsers,
  IconTarget,
  IconAlert,
  IconCar,
  IconBox,
  IconWrench,
  IconShield,
  IconTrendUp,
  IconArchive,
  IconBuilding,
  IconLock,
  IconClipboard,
  IconCalendar,
  IconCash,
  IconMenu,
  IconX,
  IconGauge,
  IconSearch,
} from '@/components/icons';

const ICONS: Record<NavIconName, React.ComponentType<{ className?: string }>> = {
  home: IconHome,
  document: IconDocument,
  users: IconUsers,
  target: IconTarget,
  contract: IconClipboard,
  alert: IconAlert,
  car: IconCar,
  box: IconBox,
  wrench: IconWrench,
  shield: IconShield,
  chart: IconTrendUp,
  archive: IconArchive,
  building: IconBuilding,
  lock: IconLock,
  calendar: IconCalendar,
  cash: IconCash,
  gauge: IconGauge,
};

// Formulaires (création, modification, signature) : colonne de lecture
// confortable. Listes et fiches : pleine largeur (1400 px au plus).
function isFormPage(pathname: string) {
  return /\/(new|edit|sign|import)(\/|$)/.test(pathname) || /\/new\/[^/]+$/.test(pathname);
}

function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export interface AppShellProps {
  navigation: NavGroup[];
  organization: { name?: string | null; logoUrl?: string | null };
  user: { name: string; email: string; roleLabel: string };
  topbarRight: React.ReactNode;
  children: React.ReactNode;
}

export function AppShell({ navigation, organization, user, topbarRight, children }: AppShellProps) {
  const pathname = usePathname() ?? '';
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Tableau de bord : la barre du haut se fond dans le bandeau bleu nuit.
  const cockpit = pathname === '/dashboard';
  const narrow = isFormPage(pathname);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen lg:flex lg:flex-col">
        <Sidebar navigation={navigation} organization={organization} user={user} pathname={pathname} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button aria-label="Fermer le menu" className="absolute inset-0 bg-nuit/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[260px] max-w-[85vw] flex-col">
            <Sidebar navigation={navigation} organization={organization} user={user} pathname={pathname} />
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Fermer le menu"
              className="absolute right-3 top-5 rounded-md p-1.5 text-encre-3 hover:bg-papier hover:text-encre"
            >
              <IconX className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      <div className="min-w-0">
        <header
          data-tone={cockpit ? 'dark' : 'light'}
          className={`sticky top-0 z-30 flex h-[62px] items-center gap-3 border-b px-4 lg:px-8 ${
            cockpit ? 'border-nuit-3 bg-nuit' : 'border-trait bg-white'
          }`}
        >
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Ouvrir le menu"
            className="tb-icon lg:hidden"
          >
            <IconMenu className="h-4 w-4" />
          </button>
          <form action="/recherche" className="tb-search" role="search">
            <IconSearch className="h-4 w-4 shrink-0 opacity-70" />
            <input
              name="q"
              type="search"
              placeholder="Chercher un client, une facture, un numéro de châssis"
              aria-label="Rechercher"
            />
          </form>
          <div className="ml-auto flex items-center gap-3">{topbarRight}</div>
        </header>

        <main className={cockpit ? '' : 'px-4 pb-11 pt-6 lg:px-8 lg:pt-7'}>
          {cockpit ? children : <div className={`mx-auto ${narrow ? 'max-w-3xl' : 'max-w-[1400px]'}`}>{children}</div>}
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  navigation,
  organization,
  user,
  pathname,
}: {
  navigation: NavGroup[];
  organization: AppShellProps['organization'];
  user: AppShellProps['user'];
  pathname: string;
}) {
  const initials = user.name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex h-full flex-col border-r border-trait bg-white">
      <Link href="/dashboard" className="flex items-center gap-2.5 px-[18px] py-[18px]">
        <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[7px] bg-rouge">
          <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M7 4v12M7 10l6-6M7 10l6 6" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="min-w-0">
          <b className="block truncate font-display text-[15px] font-bold tracking-[-0.01em]">
            {organization.name?.replace(/\s*SARL$/i, '') || 'KF Auto'}
          </b>
          <span className="block text-xs text-encre-3">Chery Togo</span>
        </span>
      </Link>

      <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto px-2.5 pb-3 pt-1">
        {navigation.map((group, gi) => (
          <div key={group.label || gi}>
            {group.label && <p className="px-2.5 pb-1.5 pt-4 text-xs font-medium text-encre-3">{group.label}</p>}
            {group.items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13.5px] ${
                    active ? 'bg-nuit text-white' : 'text-encre-2 hover:bg-papier hover:text-encre'
                  }`}
                >
                  <Icon className="h-[17px] w-[17px] shrink-0" />
                  <span className="truncate">{item.label}</span>
                  {typeof item.count === 'number' && item.count > 0 && (
                    <span className={`num ml-auto text-[11.5px] ${active ? 'text-acier' : 'text-encre-3'}`}>{item.count}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex items-center gap-2.5 border-t border-trait px-4 py-3.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-nuit text-xs font-semibold text-white">
          {initials || '?'}
        </span>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[13px] font-semibold">{user.name || user.email}</b>
          <span className="block truncate text-xs text-encre-3">{user.roleLabel}</span>
        </span>
        <LogoutButton />
      </div>
    </div>
  );
}
