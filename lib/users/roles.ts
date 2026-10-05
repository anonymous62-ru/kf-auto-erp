// Types et libellés partagés (composants client + server actions).
// Séparé de actions.ts car un fichier 'use server' ne peut exporter QUE
// des fonctions async — un simple export de constante casserait le build.
export type UserRole =
  | 'super_admin'
  | 'administrateur'
  | 'manager'
  | 'comptable'
  | 'commercial'
  | 'receptionniste_sav'
  | 'chef_atelier'
  | 'technicien'
  | 'magasinier'
  | 'responsable_showroom';

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  administrateur: 'Administrateur',
  manager: 'Manager',
  comptable: 'Comptable (caissière/comptabilité)',
  commercial: 'Commercial',
  receptionniste_sav: 'Réceptionniste SAV (secrétariat atelier)',
  chef_atelier: "Chef d'atelier",
  technicien: 'Technicien',
  magasinier: 'Magasinier (pièces)',
  responsable_showroom: 'Responsable showroom',
};

export function roleLabel(role: UserRole) {
  return ROLE_LABELS[role] ?? role;
}

export const ALL_ROLES: UserRole[] = [
  'super_admin',
  'administrateur',
  'manager',
  'comptable',
  'commercial',
  'receptionniste_sav',
  'chef_atelier',
  'technicien',
  'magasinier',
  'responsable_showroom',
];
