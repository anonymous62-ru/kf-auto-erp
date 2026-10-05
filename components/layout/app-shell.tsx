'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavGroup, NavIconName } from '@/lib/navigation';
import { OrganizationBadge } from '@/components/organization-badge';
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
  IconMenu,
  IconX,
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
};

// Pages qui ont besoin de toute la largeur (tableaux, indicateurs). Les
// autres écrans (fiches, formulaires) restent sur une colonne de lecture
// confortable, comme avant.
const WIDE_PAGES = ['/dashboard', '/documents'];

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

  // Referme le menu mobile dès qu'on change de page.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const current = navigation
    .flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })))
    .filter((i) => isActive(pathname, i.href))
    .sort((a, b) => b.href.length - a.href.length)[0];

  const wide = WIDE_PAGES.includes(pathname);

  return (
    <div className="min-h-screen lg:pl-64">
      {/* Barre latérale fixe (ordinateur) */}
      <aside className="hidden lg:flex lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 lg:flex-col">
        <Sidebar navigation={navigation} organization={organization} user={user} pathname={pathname} />
      </aside>

      {/* Menu coulissant (téléphone / tablette) */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <button
            aria-label="Fermer le menu"
            className="absolute inset-0 bg-gray-950/50"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] flex flex-col shadow-xl">
            <Sidebar navigation={navigation} organization={organization} user={user} pathname={pathname} />
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Fermer le menu"
              className="absolute top-4 right-3 p-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10"
            >
              <IconX className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Barre supérieure */}
      <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur border-b border-gray-200 flex items-center gap-3 px-4 lg:px-8">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Ouvrir le menu"
          className="lg:hidden -ml-1 p-1.5 rounded-md text-gray-600 hover:bg-gray-100"
        >
          <IconMenu className="w-5 h-5" />
        </button>
        <Link href="/dashboard" className="lg:hidden flex items-center gap-2 min-w-0">
          <OrganizationBadge
            logoUrl={organization.logoUrl}
            name={organization.name}
            className="h-7 w-7 rounded-md bg-kf-navy text-white text-[11px]"
          />
          <span className="text-sm font-semibold text-gray-900 truncate">KF Auto ERP</span>
        </Link>
        <nav aria-label="Fil d'Ariane" className="hidden lg:flex items-center gap-2 text-sm min-w-0">
          {current && current.href !== '/dashboard' ? (
            <>
              <span className="text-gray-400">{current.group}</span>
              <span className="text-gray-300">/</span>
              <Link href={current.href} className="font-medium text-gray-900 truncate hover:text-kf-navy">
                {current.label}
              </Link>
            </>
          ) : (
            <span className="font-medium text-gray-900">Tableau de bord</span>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">{topbarRight}</div>
      </header>

      <main className="px-4 py-5 sm:py-6 lg:px-8 lg:py-8">
        <div className={`mx-auto ${wide ? 'max-w-7xl' : 'max-w-4xl'}`}>{children}</div>
      </main>
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
    <div className="flex h-full flex-col bg-kf-navy-950 text-white">
      <div className="brand-stripe">
        <span />
        <span />
        <span />
        <span />
      </div>

      <Link href="/dashboard" className="flex items-center gap-3 px-5 h-16 border-b border-white/[0.06]">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white p-1">
          <OrganizationBadge
            logoUrl={organization.logoUrl}
            name={organization.name}
            className="h-full w-full rounded-md text-kf-navy text-xs"
          />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold tracking-tight truncate">{organization.name || 'KF Auto SARL'}</span>
          <span className="block text-[11px] text-white/45">Chery Togo · ERP</span>
        </span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {navigation.map((group) => (
          <div key={group.label}>
            <p className="px-2 mb-1.5 text-[11px] font-medium uppercase tracking-wider text-white/35">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={`relative flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors ${
                        active
                          ? 'bg-white/[0.08] text-white font-medium'
                          : 'text-white/65 hover:bg-white/[0.05] hover:text-white'
                      }`}
                    >
                      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-kf-red" />}
                      <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? 'text-kf-orange' : 'text-white/45'}`} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.06] p-3">
        <div className="flex items-center gap-3 rounded-md px-2 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-kf-navy-400 text-xs font-semibold">
            {initials || '?'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium truncate">{user.name || user.email}</span>
            <span className="block text-[11px] text-white/45 truncate">{user.roleLabel}</span>
          </span>
          <LogoutButton />
        </div>
      </div>
    </div>
  );
}
