// Navigation de l'application, calculée selon le rôle de l'utilisateur.
// Ce filtrage est uniquement une question d'ergonomie (ne pas montrer un
// lien qui mènerait à une page vide) : la vraie protection des données reste
// la RLS côté Supabase, qui s'applique quoi qu'affiche le menu.

export type NavIconName =
  | 'home'
  | 'document'
  | 'users'
  | 'target'
  | 'contract'
  | 'alert'
  | 'car'
  | 'box'
  | 'wrench'
  | 'shield'
  | 'chart'
  | 'archive'
  | 'building'
  | 'lock';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// Rôles qui travaillent sur les devis/factures/clients (chacun ne voit que
// ce que la RLS lui laisse voir : un commercial ne voit que ses propres
// dossiers, la caissière/secrétaire/manager voient toute l'organisation).
const COMMERCIAL_ROLES = ['super_admin', 'administrateur', 'manager', 'comptable', 'commercial', 'receptionniste_sav'];
const ADMIN_ROLES = ['super_admin', 'administrateur'];

export function canSeeCommercial(role: string | null | undefined) {
  return !!role && COMMERCIAL_ROLES.includes(role);
}

export function isAdmin(role: string | null | undefined) {
  return !!role && ADMIN_ROLES.includes(role);
}

export function getNavigation(role: string | null | undefined): NavGroup[] {
  const groups: NavGroup[] = [
    { label: 'Général', items: [{ href: '/dashboard', label: 'Tableau de bord', icon: 'home' }] },
  ];

  if (canSeeCommercial(role)) {
    groups.push({
      label: 'Commercial',
      items: [
        { href: '/documents', label: 'Devis et factures', icon: 'document' },
        { href: '/clients', label: 'Clients', icon: 'users' },
        { href: '/prospects', label: 'Prospects', icon: 'target' },
        { href: '/contracts', label: 'Contrats de vente', icon: 'contract' },
        { href: '/impayes', label: 'Impayés', icon: 'alert' },
      ],
    });
  } else if (role === 'responsable_showroom') {
    // Demande du DG (04/10) : la responsable showroom crée les clients et les
    // proformas des visiteurs du showroom, mais ne voit jamais les dossiers
    // des commerciaux. La RLS ne lui renvoie que ce qu'elle a elle-même créé.
    groups.push({
      label: 'Showroom',
      items: [
        { href: '/documents', label: 'Mes proformas', icon: 'document' },
        { href: '/clients', label: 'Mes clients', icon: 'users' },
      ],
    });
  }

  groups.push({
    label: 'Stock et atelier',
    items: [
      { href: '/products', label: 'Véhicules', icon: 'car' },
      { href: '/pieces', label: 'Pièces détachées', icon: 'box' },
      { href: '/atelier', label: 'Atelier / SAV', icon: 'wrench' },
      { href: '/garanties', label: 'Garanties', icon: 'shield' },
    ],
  });

  if (isAdmin(role)) {
    groups.push({
      label: 'Administration',
      items: [
        { href: '/team', label: 'Suivi des commerciaux', icon: 'chart' },
        { href: '/users', label: 'Utilisateurs', icon: 'users' },
        { href: '/audit', label: "Journal d'audit", icon: 'archive' },
        { href: '/settings/organisation', label: 'Organisation', icon: 'building' },
      ],
    });
  }

  groups.push({
    label: 'Compte',
    items: [{ href: '/settings/security', label: 'Sécurité (2FA)', icon: 'lock' }],
  });

  return groups;
}
