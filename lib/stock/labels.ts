// Statuts et ancienneté des véhicules en stock (étape 2, direction 09/10/2026).
// Fichier sans 'use server' : utilisable côté client et côté serveur.

export type VehicleStatus = 'disponible' | 'reserve' | 'demo' | 'essai' | 'endommage' | 'vendu';

export const VEHICLE_STATUS: Record<VehicleStatus, { label: string; badge: string; short: string }> = {
  disponible: { label: 'Disponible à la vente', short: 'Disponible', badge: 'badge-green' },
  reserve: { label: 'Réservé (acompte versé)', short: 'Réservé', badge: 'badge-amber' },
  demo: { label: 'Plaque démo', short: 'Démo', badge: 'badge-blue' },
  essai: { label: 'Réservé pour essais', short: 'Essais', badge: 'badge-sky' },
  endommage: { label: 'Endommagé', short: 'Endommagé', badge: 'badge-red' },
  vendu: { label: 'Vendu', short: 'Vendu', badge: 'badge-gray' },
};

export const VEHICLE_STATUS_ORDER: VehicleStatus[] = ['disponible', 'reserve', 'demo', 'essai', 'endommage', 'vendu'];

// Statuts que l'on peut poser à la main (les autres suivent les paiements ;
// seule la direction peut les corriger).
export const MANUAL_STATUSES: VehicleStatus[] = ['disponible', 'demo', 'essai', 'endommage'];

export function vehicleStatus(status: string) {
  return VEHICLE_STATUS[status as VehicleStatus] ?? { label: status, short: status, badge: 'badge-gray' };
}

// Nombre de jours depuis l'entrée en stock (date au format AAAA-MM-JJ).
export function daysInStock(entryDate: string, until?: string | null) {
  const start = new Date(`${entryDate}T00:00:00Z`).getTime();
  const end = until ? new Date(until).getTime() : Date.now();
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

// "en stock depuis 2 mois", "depuis 12 jours", "depuis 1 an et 3 mois"
export function ageLabel(days: number) {
  if (days < 1) return "entré aujourd'hui";
  if (days < 31) return `depuis ${days} jour${days > 1 ? 's' : ''}`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `depuis ${months} mois`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return `depuis ${years} an${years > 1 ? 's' : ''}${rest ? ` et ${rest} mois` : ''}`;
}

export const AGE_BUCKETS = [
  { value: 'moins1', label: "Moins d'1 mois", min: 0, max: 30 },
  { value: '1a3', label: '1 à 3 mois', min: 31, max: 91 },
  { value: '3a6', label: '3 à 6 mois', min: 92, max: 182 },
  { value: 'plus6', label: 'Plus de 6 mois', min: 183, max: Infinity },
] as const;

export type AgeBucket = (typeof AGE_BUCKETS)[number]['value'];

// Couleur de l'ancienneté : au-delà de 3 mois, le véhicule "dort".
export function ageTone(days: number) {
  if (days > 182) return 'text-red-600';
  if (days > 91) return 'text-orange-600';
  return 'text-gray-500';
}
