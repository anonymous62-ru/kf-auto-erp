// Types et libellés partagés (composants client + server actions).
// Séparé de actions.ts car un fichier 'use server' ne peut exporter QUE
// des fonctions async — un simple export de constante casserait le build.
export type UserRole = 'super_admin' | 'administrateur' | 'manager' | 'comptable' | 'commercial';

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  administrateur: 'Administrateur',
  manager: 'Manager',
  comptable: 'Comptable',
  commercial: 'Commercial',
};

export function roleLabel(role: UserRole) {
  return ROLE_LABELS[role] ?? role;
}

export const ALL_ROLES: UserRole[] = ['super_admin', 'administrateur', 'manager', 'comptable', 'commercial'];
