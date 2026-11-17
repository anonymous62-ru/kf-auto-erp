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
  | 'lock'
  | 'calendar'
  | 'cash'
  | 'gauge';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
  // Compteur discret affiché à droite (leads actifs, impayés...).
  count?: number;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// Rôles qui travaillent sur les proformas/commandes/factures/clients (chacun
// ne voit que ce que la RLS lui laisse voir : un commercial ne voit que ses
// propres dossiers, la caisse/l'administration des ventes/la direction voient
// toute l'organisation).
const COMMERCIAL_ROLES = [
  'super_admin',
  'administrateur',
  'manager',
  'comptable',
  'admin_ventes',
  'commercial',
  'chef_service',
  'receptionniste_sav',
  'responsable_commercial',
];
const ADMIN_ROLES = ['super_admin', 'administrateur'];
const DIRECTION_ROLES = ['super_admin', 'administrateur', 'manager'];
const SHOWROOM_ROLES = ['responsable_showroom', 'vendeur_showroom'];
const TEAM_SALES_ROLES = [
  'super_admin',
  'administrateur',
  'manager',
  'comptable',
  'receptionniste_sav',
  'admin_ventes',
  'commercial',
  'chef_service',
  'responsable_commercial',
];
// Affaires et agenda : commerciaux, leurs chefs, l'administration des ventes et la direction.
const AFFAIRES_ROLES = ['super_admin', 'administrateur', 'manager', 'admin_ventes', 'commercial', 'chef_service', 'responsable_commercial'];
// Rôles qui dirigent un département et peuvent demander une inscription.
const REQUESTER_ROLES = ['chef_atelier', 'responsable_showroom', 'chef_service'];

export function canSeeCommercial(role: string | null | undefined) {
  return !!role && COMMERCIAL_ROLES.includes(role);
}

export function isAdmin(role: string | null | undefined) {
  return !!role && ADMIN_ROLES.includes(role);
}

export function isShowroomRole(role: string | null | undefined) {
  return !!role && SHOWROOM_ROLES.includes(role);
}

// Raccourcis du circuit de vente : tous les rôles non commerciaux valident
// (précision du 17/11). Les notifications « Mes actions » ciblent toujours en
// priorité le responsable commercial, l'ADV puis la direction.
const VALIDATOR_ROLES = ['super_admin', 'administrateur', 'manager', 'responsable_commercial', 'admin_ventes', 'comptable'];

function circuitShortcuts(role: string | null | undefined): NavItem[] {
  if (!role || !VALIDATOR_ROLES.includes(role)) return [];
  return [
    { href: '/documents?etape=proforma_a_valider', label: 'Proformas à valider', icon: 'document' },
    { href: '/documents?etape=commande_a_verifier', label: 'Bons de commande à vérifier', icon: 'document' },
    { href: '/documents?etape=facture_a_valider', label: 'Factures à valider', icon: 'document' },
  ];
}

export function getNavigation(role: string | null | undefined): NavGroup[] {
  const groups: NavGroup[] = [
    {
      label: '',
      items: [
        { href: '/dashboard', label: 'Tableau de bord', icon: 'gauge' },
        { href: '/actions', label: 'Mes actions', icon: 'alert' },
      ],
    },
  ];

  if (canSeeCommercial(role)) {
    const items: NavItem[] = [{ href: '/prospects', label: 'Leads', icon: 'target' }];
    if (role && AFFAIRES_ROLES.includes(role)) items.push({ href: '/affaires', label: 'Affaires', icon: 'cash' });
    items.push(
      { href: '/documents', label: 'Proformas et factures', icon: 'document' },
      // Circuit de vente (0044) : raccourci vers les documents à traiter selon le rôle.
      ...circuitShortcuts(role),
      { href: '/clients', label: 'Clients', icon: 'users' }
    );
    if (role && AFFAIRES_ROLES.includes(role)) items.push({ href: '/agenda', label: 'Agenda', icon: 'calendar' });
    if (role && TEAM_SALES_ROLES.includes(role)) {
      items.push({ href: '/ventes', label: "Ventes de l'équipe", icon: 'chart' });
    }
    items.push(
      { href: '/contracts', label: 'Contrats de vente', icon: 'contract' },
      { href: '/impayes', label: 'Impayés', icon: 'alert' }
    );
    groups.push({ label: 'Vente', items });
  } else if (isShowroomRole(role)) {
    // Demande du DG (04/10) : le showroom crée les clients et les factures
    // proforma des visiteurs, mais ne voit jamais les dossiers des
    // commerciaux. La RLS ne lui renvoie que ce qu'il a lui-même créé.
    groups.push({
      label: 'Showroom',
      items: [
        { href: '/documents', label: 'Mes factures proforma', icon: 'document' },
        { href: '/clients', label: 'Mes clients et prospects', icon: 'users' },
      ],
    });
  } else if (role === 'marketing') {
    groups.push({
      label: 'Marketing',
      items: [
        { href: '/prospects', label: 'Leads', icon: 'target' },
        { href: '/campagnes', label: 'Campagnes', icon: 'chart' },
      ],
    });
  }

  // Pilotage (étape 4) : rapports pour la direction, campagnes visibles aussi
  // par l'administration des ventes et les chefs de service.
  if (role && ['super_admin', 'administrateur', 'manager', 'admin_ventes', 'chef_service'].includes(role)) {
    groups.push({
      label: 'Direction',
      items: [
        { href: '/rapports', label: 'Rapports', icon: 'chart' },
        { href: '/campagnes', label: 'Campagnes', icon: 'target' },
      ],
    });
  }

  // Objectifs commerciaux en véhicules (étape 7) : direction et responsable commercial.
  if (role && ['super_admin', 'administrateur', 'manager', 'responsable_commercial'].includes(role)) {
    const objectives: NavItem = { href: '/objectifs', label: 'Objectifs commerciaux', icon: 'target' };
    const direction = groups.find((g) => g.label === 'Direction');
    if (direction) direction.items.unshift(objectives);
    else groups.push({ label: 'Direction', items: [objectives] });
  }

  groups.push({
    label: 'Parc et atelier',
    items: [
      { href: '/stock', label: 'Véhicules', icon: 'car' },
      { href: '/products', label: 'Catalogue', icon: 'archive' },
      { href: '/pieces', label: 'Pièces détachées', icon: 'box' },
      { href: '/atelier', label: 'Atelier', icon: 'wrench' },
      { href: '/garanties', label: 'Garanties', icon: 'shield' },
    ],
  });

  const adminItems: NavItem[] = [];
  if (isAdmin(role)) {
    adminItems.push(
      { href: '/team', label: 'Suivi des commerciaux', icon: 'chart' },
      { href: '/users', label: 'Utilisateurs', icon: 'users' }
    );
  }
  if (role && DIRECTION_ROLES.includes(role)) {
    adminItems.push({ href: '/users/demandes', label: "Demandes d'inscription", icon: 'users' });
  } else if (role && REQUESTER_ROLES.includes(role)) {
    adminItems.push({ href: '/users/demandes', label: 'Demander une inscription', icon: 'users' });
  }
  if (isAdmin(role)) {
    adminItems.push(
      { href: '/audit', label: "Journal d'audit", icon: 'archive' },
      { href: '/settings/organisation', label: 'Organisation', icon: 'building' }
    );
  }
  // Le manager fixait l'objectif en F CFA sur la page Organisation : il passe
  // désormais par « Objectifs commerciaux » (groupe Direction).
  if (adminItems.length > 0) groups.push({ label: 'Administration', items: adminItems });

  groups.push({
    label: 'Compte',
    items: [
      { href: '/settings/security', label: 'Sécurité (2FA)', icon: 'lock' },
      { href: '/settings/notifications', label: 'Notifications', icon: 'calendar' },
    ],
  });

  return groups;
}
