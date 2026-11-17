// Fiche de réception / restitution SAV (migration 0047) : libellés, types
// et comparaison entrée / sortie. Fichier sans dépendance serveur, partagé
// par les formulaires (client), les pages et le PDF.

export type InspectionKind = 'reception' | 'restitution';

export const INSPECTION_KIND_LABELS: Record<InspectionKind, string> = {
  reception: 'Fiche de réception',
  restitution: 'Fiche de restitution',
};

export function isInspectionKind(value: string): value is InspectionKind {
  return value === 'reception' || value === 'restitution';
}

export const INSPECTION_BUCKET = 'sav-inspections';

// Rôles autorisés à remplir la fiche (alignés sur can_write_vehicle_inspection).
export const INSPECTION_WRITE_ROLES = [
  'super_admin',
  'administrateur',
  'manager',
  'receptionniste_sav',
  'chef_atelier',
  'responsable_showroom',
];
export const DIRECTION_ROLES = ['super_admin', 'administrateur', 'manager'];

// ---------- Carrosserie ----------
export const BODY_ZONES = [
  { key: 'avant', label: 'Avant (pare-chocs, capot)' },
  { key: 'arriere', label: 'Arrière (pare-chocs, coffre)' },
  { key: 'cote_gauche', label: 'Côté gauche' },
  { key: 'cote_droit', label: 'Côté droit' },
  { key: 'toit', label: 'Toit' },
  { key: 'pare_brise', label: 'Pare-brise / vitres' },
  { key: 'retroviseurs', label: 'Rétroviseurs' },
  { key: 'jantes', label: 'Jantes / pneus' },
  { key: 'interieur', label: 'Intérieur (sièges, tableau de bord)' },
] as const;

export const DAMAGE_TYPES = [
  { key: 'rayure', label: 'Rayure' },
  { key: 'bosse', label: 'Bosse' },
  { key: 'eclat', label: 'Éclat / fissure' },
  { key: 'casse', label: 'Pièce cassée' },
  { key: 'tache', label: 'Tache / salissure' },
  { key: 'autre', label: 'Autre' },
] as const;

// ---------- Voyants allumés ----------
export const WARNING_LIGHTS = [
  { key: 'moteur', label: 'Moteur' },
  { key: 'abs', label: 'ABS' },
  { key: 'airbag', label: 'Airbag' },
  { key: 'huile', label: 'Huile' },
  { key: 'batterie', label: 'Batterie' },
  { key: 'temperature', label: 'Température' },
  { key: 'pression_pneus', label: 'Pression des pneus' },
  { key: 'freins', label: 'Freins' },
  { key: 'autre', label: 'Autre' },
] as const;

// ---------- Accessoires présents ----------
export const ACCESSORIES = [
  { key: 'roue_secours', label: 'Roue de secours' },
  { key: 'cric', label: 'Cric' },
  { key: 'cle_roue', label: 'Clé de roue' },
  { key: 'triangle', label: 'Triangle' },
  { key: 'gilet', label: 'Gilet' },
  { key: 'extincteur', label: 'Extincteur' },
  { key: 'tapis', label: 'Tapis' },
  { key: 'radio_ecran', label: 'Radio / écran' },
  { key: 'double_cles', label: 'Double des clés' },
  { key: 'carnet_entretien', label: "Carnet d'entretien" },
  { key: 'autre', label: 'Autre' },
] as const;

export interface BodyDamage {
  zone: string;
  type: string;
  comment?: string;
}

export interface InspectionChecklist {
  body_ok?: boolean;
  body_damages?: BodyDamage[];
  warning_lights?: string[];
  warning_lights_other?: string;
  accessories?: string[];
  accessories_other?: string;
}

export interface InspectionRow {
  id: string;
  repair_order_id: string;
  organization_id: string;
  kind: InspectionKind;
  receptionist_name: string | null;
  inspected_at: string;
  mileage: number | null;
  fuel_level: number | null;
  checklist: InspectionChecklist;
  observations: string | null;
  photos: string[];
  client_signature_url: string | null;
  client_signed_at: string | null;
  client_signer_name: string | null;
  created_at: string;
  updated_at: string;
}

export const INSPECTION_COLUMNS =
  'id, repair_order_id, organization_id, kind, receptionist_name, inspected_at, mileage, fuel_level, checklist, observations, photos, client_signature_url, client_signed_at, client_signer_name, created_at, updated_at';

export function normalizeChecklist(raw: unknown): InspectionChecklist {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const strArray = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const damages = Array.isArray(c.body_damages)
    ? (c.body_damages as unknown[])
        .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
        .map((d) => ({
          zone: String(d.zone ?? ''),
          type: String(d.type ?? ''),
          comment: d.comment ? String(d.comment) : '',
        }))
        .filter((d) => d.zone && d.type)
    : [];
  return {
    body_ok: c.body_ok === true,
    body_damages: damages,
    warning_lights: strArray(c.warning_lights),
    warning_lights_other: typeof c.warning_lights_other === 'string' ? c.warning_lights_other : '',
    accessories: strArray(c.accessories),
    accessories_other: typeof c.accessories_other === 'string' ? c.accessories_other : '',
  };
}

// ---------- Carburant (huitièmes de réservoir) ----------
const FUEL_LABELS = ['Vide', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8', 'Plein'];

export function fuelLabel(level: number | null | undefined): string {
  if (level === null || level === undefined || level < 0 || level > 8) return 'Non relevé';
  return FUEL_LABELS[level];
}

export function labelOf(list: readonly { key: string; label: string }[], key: string): string {
  return list.find((i) => i.key === key)?.label ?? key;
}

export function zoneLabel(key: string) {
  return labelOf(BODY_ZONES, key);
}
export function damageLabel(key: string) {
  return labelOf(DAMAGE_TYPES, key);
}

export function formatKm(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Non relevé';
  return `${value.toLocaleString('fr-FR').replace(/ | /g, ' ')} km`;
}

// ---------- Comparaison entrée / sortie ----------
export interface InspectionComparison {
  distanceKm: number | null;
  fuelIn: number | null;
  fuelOut: number | null;
  fuelDropped: boolean;
  newWarningLights: string[];
  clearedWarningLights: string[];
  missingAccessories: string[];
  newDamages: BodyDamage[];
  hasDegradation: boolean;
}

function damageKey(d: BodyDamage) {
  return `${d.zone}|${d.type}`;
}

export function compareInspections(entry: InspectionRow, exit: InspectionRow): InspectionComparison {
  const inC = normalizeChecklist(entry.checklist);
  const outC = normalizeChecklist(exit.checklist);

  const distanceKm =
    entry.mileage !== null && exit.mileage !== null ? Math.max(0, exit.mileage - entry.mileage) : null;

  const lightsIn = new Set(inC.warning_lights);
  const lightsOut = new Set(outC.warning_lights);
  const newWarningLights = [...lightsOut].filter((l) => !lightsIn.has(l));
  const clearedWarningLights = [...lightsIn].filter((l) => !lightsOut.has(l));

  const accOut = new Set(outC.accessories);
  const missingAccessories = (inC.accessories ?? []).filter((a) => !accOut.has(a));

  const damagesIn = new Set((inC.body_damages ?? []).map(damageKey));
  const newDamages = (outC.body_damages ?? []).filter((d) => !damagesIn.has(damageKey(d)));

  const fuelDropped =
    entry.fuel_level !== null && exit.fuel_level !== null && exit.fuel_level < entry.fuel_level;

  return {
    distanceKm,
    fuelIn: entry.fuel_level,
    fuelOut: exit.fuel_level,
    fuelDropped,
    newWarningLights,
    clearedWarningLights,
    missingAccessories,
    newDamages,
    hasDegradation:
      fuelDropped || newWarningLights.length > 0 || missingAccessories.length > 0 || newDamages.length > 0,
  };
}
