// Périodes des objectifs commerciaux (fuseau de Lomé, UTC+0 sans heure
// d'été). Fonctions pures : utilisables côté serveur et côté navigateur.

export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export type Range = { from: string; to: string };

export function lomeToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lome' });
}

function iso(y: number, m0: number, d: number) {
  return new Date(Date.UTC(y, m0, d)).toISOString().slice(0, 10);
}

function parts(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return { y, m0: m - 1, d };
}

export function monthRange(day: string, offset = 0): Range {
  const { y, m0 } = parts(day);
  return { from: iso(y, m0 + offset, 1), to: iso(y, m0 + offset + 1, 0) };
}

export function quarterRange(day: string, offset = 0): Range {
  const { y, m0 } = parts(day);
  const q0 = Math.floor(m0 / 3) * 3 + offset * 3;
  return { from: iso(y, q0, 1), to: iso(y, q0 + 3, 0) };
}

export function yearRange(day: string): Range {
  const { y } = parts(day);
  return { from: iso(y, 0, 1), to: iso(y, 11, 31) };
}

// Filtres de période proposés (tableau de bord et page des objectifs).
export const PERIOD_FILTERS = [
  { key: 'mois', label: 'Mois en cours' },
  { key: 'mois-precedent', label: 'Mois précédent' },
  { key: 'mois-prochain', label: 'Mois prochain' },
  { key: 'trimestre', label: 'Trimestre en cours' },
  { key: 'annee', label: 'Année en cours' },
] as const;
export type PeriodFilterKey = (typeof PERIOD_FILTERS)[number]['key'];

export function resolvePeriodFilter(key: string | undefined, today = lomeToday()): { key: PeriodFilterKey; range: Range } {
  switch (key) {
    case 'mois-precedent':
      return { key, range: monthRange(today, -1) };
    case 'mois-prochain':
      return { key, range: monthRange(today, 1) };
    case 'trimestre':
      return { key, range: quarterRange(today) };
    case 'annee':
      return { key, range: yearRange(today) };
    default:
      return { key: 'mois', range: monthRange(today) };
  }
}

// « novembre 2026 », « 4e trimestre 2026 », « année 2026 » ou « du 3 nov. au 20 déc. 2026 ».
export function formatPeriod(from: string, to: string) {
  const a = parts(from);
  const b = parts(to);
  const lastOfB = parts(iso(b.y, b.m0 + 1, 0)).d;
  const fullMonths = a.d === 1 && b.d === lastOfB;
  if (fullMonths && a.y === b.y && a.m0 === b.m0) return `${MONTHS[a.m0]} ${a.y}`;
  if (fullMonths && a.y === b.y && a.m0 % 3 === 0 && b.m0 === a.m0 + 2) {
    const q = a.m0 / 3 + 1;
    return `${q === 1 ? '1er' : `${q}e`} trimestre ${a.y}`;
  }
  if (fullMonths && a.y === b.y && a.m0 === 0 && b.m0 === 11) return `année ${a.y}`;
  if (fullMonths) {
    return a.y === b.y
      ? `${MONTHS[a.m0]} à ${MONTHS[b.m0]} ${a.y}`
      : `${MONTHS[a.m0]} ${a.y} à ${MONTHS[b.m0]} ${b.y}`;
  }
  const left = `${a.d === 1 ? '1er' : a.d} ${MONTHS_SHORT[a.m0]}${a.y !== b.y ? ` ${a.y}` : ''}`;
  return `du ${left} au ${b.d === 1 ? '1er' : b.d} ${MONTHS_SHORT[b.m0]} ${b.y}`;
}

export function vehicles(n: number) {
  return `${n} véhicule${Math.abs(n) > 1 ? 's' : ''}`;
}
