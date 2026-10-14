// Types et libellés partagés (composants client + server actions).
// Séparé de actions.ts car un fichier 'use server' ne peut exporter QUE
// des fonctions async — un simple export de constante casserait le build.
export type UserRole =
  | 'super_admin'
  | 'administrateur'
  | 'manager'
  | 'comptable'
  | 'admin_ventes'
  | 'commercial'
  | 'chef_service'
  | 'marketing'
  | 'receptionniste_sav'
  | 'chef_atelier'
  | 'technicien'
  | 'magasinier'
  | 'responsable_showroom'
  | 'vendeur_showroom';

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  administrateur: 'Administrateur (direction)',
  manager: 'Manager',
  comptable: 'Comptable (caissière/comptabilité)',
  admin_ventes: 'Administratrice des ventes',
  commercial: 'Commercial',
  chef_service: 'Chef de service',
  marketing: 'Chargée marketing / communication',
  receptionniste_sav: 'Réceptionniste SAV (secrétariat atelier)',
  chef_atelier: "Chef d'atelier",
  technicien: 'Technicien',
  magasinier: 'Magasinier (pièces)',
  responsable_showroom: 'Responsable showroom',
  vendeur_showroom: 'Chargé de vente showroom',
};

export function roleLabel(role: UserRole | string) {
  return ROLE_LABELS[role as UserRole] ?? role;
}

export const ALL_ROLES: UserRole[] = [
  'super_admin',
  'administrateur',
  'manager',
  'comptable',
  'admin_ventes',
  'commercial',
  'chef_service',
  'marketing',
  'receptionniste_sav',
  'chef_atelier',
  'technicien',
  'magasinier',
  'responsable_showroom',
  'vendeur_showroom',
];

// ---------- Départements (demandes d'inscription, chefs de service) ----------
// Doit rester aligné sur la fonction SQL department_allows_role (migration 0032).
export type Department = 'commercial' | 'atelier' | 'pieces' | 'showroom' | 'marketing' | 'administration';

export const DEPARTMENTS: { value: Department; label: string; roles: UserRole[] }[] = [
  { value: 'commercial', label: 'Commercial', roles: ['commercial'] },
  { value: 'atelier', label: 'Atelier / SAV', roles: ['technicien', 'magasinier', 'receptionniste_sav'] },
  { value: 'pieces', label: 'Pièces détachées', roles: ['magasinier'] },
  { value: 'showroom', label: 'Showroom', roles: ['vendeur_showroom'] },
  { value: 'marketing', label: 'Marketing et communication', roles: ['marketing'] },
  { value: 'administration', label: 'Administration', roles: ['comptable', 'admin_ventes'] },
];

export function departmentLabel(value: string | null | undefined) {
  return DEPARTMENTS.find((d) => d.value === value)?.label ?? value ?? '';
}

// Département dirigé par un rôle (null = ne dirige aucun département).
export function managedDepartment(role: string | null | undefined, department?: string | null): Department | null {
  if (role === 'chef_atelier') return 'atelier';
  if (role === 'responsable_showroom') return 'showroom';
  if (role === 'chef_service') return (department as Department) ?? null;
  return null;
}

// Groupes de rôles (alignés sur les policies de la migration 0032).
export const DIRECTION_ROLES = ['super_admin', 'administrateur', 'manager'];
export const BILLING_ROLES = ['super_admin', 'administrateur', 'manager', 'admin_ventes'];
export const SHOWROOM_ROLES = ['responsable_showroom', 'vendeur_showroom'];
export const TEAM_SALES_ROLES = [
  'super_admin',
  'administrateur',
  'manager',
  'comptable',
  'receptionniste_sav',
  'admin_ventes',
  'commercial',
  'chef_service',
];
// Rôles autorisés à faire passer directement un contact en client (clients
// déjà acquis, par exemple à l'atelier) ; les autres attendent le premier versement.
export const DIRECT_CLIENT_ROLES = [
  'super_admin',
  'administrateur',
  'manager',
  'admin_ventes',
  'comptable',
  'receptionniste_sav',
  'chef_atelier',
];
