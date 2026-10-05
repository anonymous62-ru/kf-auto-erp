// Transformation des lignes d'un fichier Excel/CSV en clients ou prospects :
// reconnaissance automatique des colonnes, nettoyage des numéros de
// téléphone, séparation entreprise / particulier, statut de prospection.
// Fichier sans 'use server' : utilisé par l'écran d'import (navigateur) et
// revérifié côté serveur avant l'enregistrement.

export type ImportKind = 'clients' | 'prospects';

export type FieldKey =
  | 'name'
  | 'contact'
  | 'first_name'
  | 'last_name'
  | 'phone'
  | 'whatsapp'
  | 'email'
  | 'address'
  | 'city'
  | 'sector'
  | 'source'
  | 'status'
  | 'next_relance'
  | 'notes'
  | 'ignore';

export const FIELD_LABELS: Record<FieldKey, string> = {
  name: 'Entreprise ou nom complet',
  contact: 'Personne à contacter (nom, fonction)',
  first_name: 'Prénom',
  last_name: 'Nom de famille',
  phone: 'Téléphone',
  whatsapp: 'WhatsApp',
  email: 'Email',
  address: 'Adresse / quartier',
  city: 'Ville',
  sector: "Secteur d'activité",
  source: 'Origine du contact',
  status: 'Statut',
  next_relance: 'Prochaine relance',
  notes: 'Ajouter aux notes',
  ignore: 'Ne pas importer',
};

export function fieldsFor(kind: ImportKind): FieldKey[] {
  const common: FieldKey[] = ['name', 'contact', 'first_name', 'last_name', 'phone', 'whatsapp', 'email', 'address'];
  return kind === 'clients'
    ? [...common, 'city', 'sector', 'notes', 'ignore']
    : [...common, 'sector', 'source', 'status', 'next_relance', 'notes', 'ignore'];
}

export function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@]+/g, ' ')
    .trim();
}

// Mots-clés reconnus dans les en-têtes de colonnes (déjà normalisés).
// L'ordre compte : la première règle qui correspond l'emporte.
const HEADER_RULES: { field: FieldKey; patterns: RegExp[] }[] = [
  { field: 'next_relance', patterns: [/prochaine (relance|action)/, /^relance/, /date (de )?relance/] },
  // "Date contact", "Date visite" : à garder dans les notes, surtout pas à
  // confondre avec la colonne "Contact".
  { field: 'notes', patterns: [/^date/] },
  { field: 'whatsapp', patterns: [/whats ?app/] },
  { field: 'email', patterns: [/e ?mail/, /courriel/, /^mail/] },
  { field: 'phone', patterns: [/telephone/, /^tel\b/, /\btel\b/, /portable/, /mobile/, /cellulaire/, /numero/, /contact tel/] },
  { field: 'first_name', patterns: [/^prenoms?$/] },
  { field: 'last_name', patterns: [/^nom de famille/, /^nom$/] },
  { field: 'contact', patterns: [/contact/, /interlocuteur/, /proprietaire/, /responsable/, /gerant/, /decideur/] },
  {
    field: 'name',
    patterns: [/entreprise/, /societe/, /raison sociale/, /^client/, /boutique/, /commerce/, /^nom/, /structure/, /etablissement/],
  },
  { field: 'sector', patterns: [/secteur/, /activite/, /domaine/, /branche/] },
  { field: 'source', patterns: [/source/, /origine/, /canal/, /provenance/] },
  { field: 'status', patterns: [/statut/, /^etat/, /status/] },
  { field: 'city', patterns: [/^ville/, /localite/, /commune/] },
  { field: 'address', patterns: [/adresse/, /quartier/, /zone/, /localisation/, /lieu/, /situation/] },
  { field: 'notes', patterns: [/note/, /comment/, /observation/, /remarque/, /besoin/, /detail/, /signal/, /interet/] },
];

export function guessField(header: string, kind: ImportKind): FieldKey {
  const h = normalize(header);
  if (!h) return 'ignore';
  const allowed = fieldsFor(kind);
  for (const rule of HEADER_RULES) {
    if (!allowed.includes(rule.field)) continue;
    if (rule.patterns.some((p) => p.test(h))) return rule.field;
  }
  // Colonne non reconnue : on la garde dans les notes plutôt que de perdre
  // l'information ("Score total", "Statut estimé"...).
  return 'notes';
}

// Ligne d'en-tête : la première ligne (parmi les 10 premières) dont au
// moins deux cellules ressemblent à des titres de colonnes connus.
export function detectHeaderRow(rows: string[][], kind: ImportKind): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const known = (rows[i] ?? []).filter((c) => c && guessField(c, kind) !== 'notes' && guessField(c, kind) !== 'ignore');
    if (known.length >= 2) return i;
  }
  return Math.max(0, rows.findIndex((r) => r.some((c) => c)));
}

export function autoMapping(headers: string[], kind: ImportKind): FieldKey[] {
  const used = new Set<FieldKey>();
  return headers.map((h) => {
    if (!h.trim()) return 'ignore';
    let field = guessField(h, kind);
    // Un même champ "simple" ne peut venir que d'une colonne : les colonnes
    // suivantes qui lui ressemblent partent dans les notes.
    if (field !== 'notes' && field !== 'ignore' && used.has(field)) field = 'notes';
    used.add(field);
    return field;
  });
}

// ---------------------------------------------------------------------------
// Téléphones et emails
// ---------------------------------------------------------------------------
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function extractEmails(text: string) {
  return Array.from(new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase())));
}

function formatTogo(digits: string) {
  return digits.replace(/(\d{2})(?=\d)/g, '$1 ');
}

// "22 21 31 06 / 90 99 69 31", "90712726", "+228 90 12 34 56", "90 12 06 30*93 94 85 58"
export function extractPhones(text: string): string[] {
  const withoutEmails = text.replace(EMAIL_RE, ' ');
  const segments = withoutEmails.split(/[\/;,*|\n]|\bet\b|\bou\b/i);
  const numbers: string[] = [];
  for (const segment of segments) {
    // Une date ("2026-09-14", "14/09/2026") a aussi 8 chiffres : à écarter.
    if (/\d{4}-\d{2}-\d{2}|\d{1,2}[.-]\d{1,2}[.-]\d{2,4}/.test(segment)) continue;
    let digits = segment.replace(/\D/g, '');
    if (!digits) continue;
    if (digits.startsWith('00228')) digits = digits.slice(5);
    else if (digits.startsWith('228') && digits.length === 11) digits = digits.slice(3);
    if (digits.length === 8) numbers.push(formatTogo(digits));
    else if (digits.length === 16) numbers.push(formatTogo(digits.slice(0, 8)), formatTogo(digits.slice(8)));
    else if (digits.length >= 9 && digits.length <= 15) numbers.push(`+${digits}`); // numéro étranger
  }
  return Array.from(new Set(numbers));
}

export function phoneKey(phone: string) {
  return phone.replace(/\D/g, '').slice(-8);
}

// Numéros mobiles togolais : 7x et 9x (les fixes commencent par 2).
const isMobile = (p: string) => /^[79]/.test(p.replace(/\D/g, ''));

// ---------------------------------------------------------------------------
// Entreprise ou particulier ?
// ---------------------------------------------------------------------------
const COMPANY_RE =
  /\b(sarl|sarlu|sa|sas|sasu|ets|etablissements?|groupe|group|societe|soci[eé]t[eé]|ste|etude|cabinet|office|agence|entreprise|ong|association|hotel|h[oô]tel|banque|bank|assurances?|services?|transports?|btp|international|internationale|ltd|inc|cie|compagnie|clinique|pharmacie|ecole|[eé]cole|universit[eé]|college|coll[eè]ge|institut|minist[eè]re|eglise|[eé]glise|holding|industries?|consulting|logistique|travaux|cargo|express|distribution|import|export|commerce|garage|restaurant|boutique|magasin|centre|direction|mairie|projet)\b/i;

export function looksLikeCompany(name: string) {
  const n = name.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (COMPANY_RE.test(n)) return true;
  if (/\bme\b|\bma[iî]tre\b/i.test(n)) return true; // "Etude Me ...", "Maître ..."
  const words = name.trim().split(/\s+/);
  // Un seul mot en majuscules ("CHOCOTOGO", "COCO") : nom commercial.
  if (words.length === 1 && name === name.toUpperCase() && /[A-Z]/.test(name)) return true;
  return false;
}

// "YAKASS Tètè Nikita F." -> nom = "YAKASS", prénoms = "Tètè Nikita F."
export function splitPersonName(full: string): { first: string; last: string } {
  const words = full.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { first: '', last: full.trim() };
  // Mots en majuscules = nom de famille (sauf initiales du type "F.").
  const upper = words.filter((w) => w === w.toUpperCase() && /[A-ZÀ-Ý]/.test(w) && w.replace(/[^A-Za-zÀ-ÿ]/g, '').length > 1);
  if (upper.length > 0 && upper.length < words.length) {
    return { last: upper.join(' '), first: words.filter((w) => !upper.includes(w)).join(' ') };
  }
  // Pas d'indication : convention togolaise courante "NOM Prénoms".
  return { last: words[0], first: words.slice(1).join(' ') };
}

// ---------------------------------------------------------------------------
// Statut / origine / dates (prospects)
// ---------------------------------------------------------------------------
export type ProspectStatus = 'nouveau' | 'contacte' | 'interesse' | 'rdv_planifie' | 'negociation' | 'converti' | 'perdu';
export type ProspectSource = 'showroom' | 'appel' | 'whatsapp' | 'site_web' | 'reseaux_sociaux' | 'recommandation' | 'autre';

export const PROSPECT_STATUSES: ProspectStatus[] = ['nouveau', 'contacte', 'interesse', 'rdv_planifie', 'negociation', 'converti', 'perdu'];
export const PROSPECT_SOURCES: ProspectSource[] = ['showroom', 'appel', 'whatsapp', 'site_web', 'reseaux_sociaux', 'recommandation', 'autre'];

export const STATUS_LABELS: Record<ProspectStatus, string> = {
  nouveau: 'Nouveau',
  contacte: 'Contacté',
  interesse: 'Intéressé',
  rdv_planifie: 'RDV planifié',
  negociation: 'Négociation',
  converti: 'Converti',
  perdu: 'Perdu',
};

export function mapStatus(text: string): ProspectStatus {
  const t = normalize(text);
  if (!t) return 'nouveau';
  if (/pas interesse|non interesse|perdu|refus|abandon|deconseille|^non$|annule/.test(t)) return 'perdu';
  if (/converti|client|gagne|vendu|signe/.test(t)) return 'converti';
  if (/negoci|devis|proforma|offre/.test(t)) return 'negociation';
  if (/rdv|rendez/.test(t)) return 'rdv_planifie';
  if (/interesse|chaud|^oui$|tres interesse/.test(t)) return 'interesse';
  if (/a contacter|nouveau|a appeler|non contacte/.test(t)) return 'nouveau';
  return 'contacte'; // "À relancer", "Sans réponse", "En cours", "À évaluer"...
}

export function mapSource(text: string): ProspectSource {
  const t = normalize(text);
  if (/showroom|visite|passage/.test(t)) return 'showroom';
  if (/whats ?app/.test(t)) return 'whatsapp';
  if (/site|web|internet|google/.test(t)) return 'site_web';
  if (/facebook|reseau|instagram|tiktok|linkedin|social/.test(t)) return 'reseaux_sociaux';
  if (/recommand|parrain|bouche|referen/.test(t)) return 'recommandation';
  if (/appel|telephon/.test(t)) return 'appel';
  return 'autre';
}

export function parseDate(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  // Date Excel stockée en nombre de jours depuis le 30/12/1899.
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const serial = Number(v);
    if (serial > 30000 && serial < 70000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Construction d'une fiche à partir d'une ligne
// ---------------------------------------------------------------------------
export interface ContactRecord {
  isCompany: boolean;
  companyName: string;
  firstName: string;
  lastName: string;
  contactName: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  city: string;
  sector: string;
  source: ProspectSource;
  status: ProspectStatus;
  nextRelance: string | null;
  notes: string;
}

export type RowIssue = 'empty' | 'example' | 'no_identity' | 'duplicate_in_file' | 'exists_mine' | 'exists_other';

export interface PreparedRow {
  line: number; // numéro de ligne dans Excel (1 = première ligne)
  record: ContactRecord;
  issue: RowIssue | null;
}

export function displayName(r: ContactRecord) {
  if (r.isCompany) return r.companyName;
  return `${r.lastName} ${r.firstName}`.trim() || r.companyName;
}

export function buildRecord(row: string[], headers: string[], mapping: FieldKey[], kind: ImportKind): ContactRecord {
  const get = (f: FieldKey) =>
    mapping
      .map((m, i) => (m === f ? (row[i] ?? '').trim() : ''))
      .filter(Boolean)
      .join(' ');

  const notes: string[] = [];
  mapping.forEach((m, i) => {
    const value = (row[i] ?? '').trim();
    const header = headers[i]?.trim() ?? '';
    // Les notes de score à 0 (critère pas encore évalué) n'apportent rien.
    if (value === '0' && /score|\(0-2\)|\/8/i.test(header)) return;
    if (m === 'notes' && value) notes.push(header ? `${header} : ${value}` : value);
  });

  // Les téléphones et emails peuvent être mélangés dans n'importe quelle
  // colonne de coordonnées (ex : "71 32 45 39 arnaudtoviak@gmail.com").
  const phoneCells = [get('phone'), get('whatsapp')].join(' / ');
  const phones = extractPhones(phoneCells);
  const emails = extractEmails([get('email'), get('phone'), get('contact')].join(' '));
  const ordered = [...phones.filter(isMobile), ...phones.filter((p) => !isMobile(p))];
  const whatsappPhones = extractPhones(get('whatsapp'));
  const phone = ordered[0] ?? '';
  const whatsapp = whatsappPhones[0] ?? '';
  const otherPhones = ordered.filter((p) => p !== phone && p !== whatsapp);
  if (otherPhones.length) notes.unshift(`Autres numéros : ${otherPhones.join(' / ')}`);
  if (emails.length > 1) notes.unshift(`Autres emails : ${emails.slice(1).join(', ')}`);

  const name = get('name');
  const contact = get('contact').replace(EMAIL_RE, '').replace(/\s{2,}/g, ' ').trim();
  let firstName = get('first_name');
  let lastName = get('last_name');
  let companyName = '';
  let isCompany = false;

  if (firstName || lastName) {
    companyName = name;
    isCompany = !!name && looksLikeCompany(name);
  } else if (name) {
    isCompany = !!contact || looksLikeCompany(name);
    if (isCompany) companyName = name;
    else ({ first: firstName, last: lastName } = splitPersonName(name));
  } else if (contact) {
    ({ first: firstName, last: lastName } = splitPersonName(contact));
  }

  const rawSource = get('source');
  if (rawSource && mapSource(rawSource) === 'autre') notes.push(`Origine : ${rawSource}`);
  const rawStatus = get('status');
  if (kind === 'prospects' && rawStatus) notes.push(`Statut d'origine : ${rawStatus}`);
  const rawRelance = get('next_relance');
  const nextRelance = parseDate(rawRelance);
  if (rawRelance && !nextRelance) notes.push(`Relance : ${rawRelance}`);

  return {
    isCompany,
    companyName,
    firstName,
    lastName,
    contactName: contact,
    phone,
    whatsapp,
    email: emails[0] ?? '',
    address: get('address'),
    city: get('city'),
    sector: get('sector'),
    source: mapSource(rawSource),
    status: mapStatus(rawStatus),
    nextRelance,
    notes: notes.join('\n'),
  };
}

// Nombre de lignes qui ressemblent à des contacts (un téléphone ou un
// email), pour proposer d'office le bon onglet d'un classeur à plusieurs
// feuilles (planning, grille de notation... à ne pas importer).
export function countContactLikeRows(rows: string[][]) {
  return rows.filter((r) => r.some((c) => c && (extractPhones(c).length > 0 || extractEmails(c).length > 0))).length;
}

export function prepareRows(
  rows: string[][],
  headerRow: number,
  mapping: FieldKey[],
  kind: ImportKind
): PreparedRow[] {
  const headers = rows[headerRow] ?? [];
  const seen = new Set<string>();
  const prepared: PreparedRow[] = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (!row.some((c) => c && c.trim())) continue; // ligne vide : ignorée sans bruit
    const record = buildRecord(row, headers, mapping, kind);
    let issue: RowIssue | null = null;
    if (row.some((c) => /^ex\s*:/i.test(c?.trim() ?? ''))) issue = 'example';
    else if (!displayName(record) && !record.phone) issue = 'no_identity';
    else if (record.phone) {
      const key = phoneKey(record.phone);
      if (seen.has(key)) issue = 'duplicate_in_file';
      seen.add(key);
    }
    prepared.push({ line: i + 1, record, issue });
  }
  return prepared;
}

export const ISSUE_LABELS: Record<RowIssue, string> = {
  empty: 'Ligne vide',
  example: "Ligne d'exemple",
  no_identity: 'Ni nom ni téléphone',
  duplicate_in_file: 'En double dans le fichier',
  exists_mine: 'Déjà dans vos contacts',
  exists_other: 'Déjà suivi par un collègue',
};

// ---------------------------------------------------------------------------
// Modèle à télécharger
// ---------------------------------------------------------------------------
export function templateCsv(kind: ImportKind) {
  const headers =
    kind === 'clients'
      ? ['Entreprise / Nom', 'Contact (nom + fonction)', 'Téléphone', 'Email', 'Adresse', 'Ville', 'Secteur', 'Notes']
      : ['Entreprise / Nom', 'Contact (nom + fonction)', 'Téléphone', 'Email', 'Secteur', 'Source', 'Statut', 'Prochaine relance', 'Notes'];
  const example =
    kind === 'clients'
      ? ['SOCIETE EXEMPLE SARL', 'M. KOFFI Jean - DG', '90 00 00 00', 'contact@exemple.tg', 'Tokoin', 'Lomé', 'BTP', '']
      : ['SOCIETE EXEMPLE SARL', 'M. KOFFI Jean - DG', '90 00 00 00', 'contact@exemple.tg', 'Transport', 'Appel', 'À relancer', '15/10/2026', 'Intéressé par un pick-up'];
  const line = (cells: string[]) => cells.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';');
  // BOM UTF-8 + point-virgule : ouverture directe avec les accents dans Excel en français.
  return `﻿${line(headers)}\n${line(example.map((c, i) => (i === 0 ? `Ex: ${c}` : c)))}\n`;
}
