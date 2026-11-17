// Caractéristiques courtes d'un véhicule pour la facture simplifiée
// (direction, 11/2026) : quelques lignes seulement (moteur, boîte, sécurité,
// places), jamais la fiche technique complète. Aucune mention de litres
// (consommation, cylindrée en L, réservoir, coffre) ni de dimensions.
//
// Fichier sans 'use server' : utilisable par le générateur PDF comme par
// l'interface.

// Une ligne contenant l'un de ces motifs n'apparaît jamais sur la facture.
const FORBIDDEN: RegExp[] = [
  /litre/i,
  /\d\s*L\b/, // 1,5 L, 6 L/100km
  /\sL\s/, // " L " isolé (capacité)
  /L\s*\/\s*100/i,
  /r[ée]servoir/i,
  /coffre/i,
  /dimension/i,
  /longueur|largeur|hauteur|empattement|garde au sol/i,
  /\d\s*mm\b/i,
  /consommation/i,
  /poids|charge utile/i,
];

export function isForbiddenSpecLine(line: string): boolean {
  return FORBIDDEN.some((re) => re.test(line));
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/^[\s,;:-]+|[\s,;:.-]+$/g, '').trim();
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

interface Section {
  title: string;
  lines: string[];
}

function splitSections(description: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { title: '', lines: [] };
  for (const raw of description.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const isBullet = line.startsWith('-') || line.startsWith('•');
    const letters = line.replace(/[^\p{L}]/gu, '');
    const isHeading = !isBullet && letters.length > 1 && line === line.toUpperCase() && line !== line.toLowerCase();
    if (isHeading) {
      if (current.title || current.lines.length) sections.push(current);
      current = { title: line, lines: [] };
    } else {
      current.lines.push(line.replace(/^[-•]\s*/, ''));
    }
  }
  if (current.title || current.lines.length) sections.push(current);
  return sections;
}

// Valeur après "Libellé :" dans une ligne de type "A : x, B : y".
function valueAfter(line: string, label: RegExp): string | null {
  const m = line.match(label);
  if (!m || m.index === undefined) return null;
  const rest = line.slice(m.index + m[0].length).replace(/^\s*:\s*/, '');
  // Coupe au prochain "Libellé :" de la même ligne.
  const next = rest.search(/,\s*[A-ZÉÈ][\p{L} ']+\s*:/u);
  return clean(next === -1 ? rest : rest.slice(0, next));
}

function engineLine(all: string[]): string | null {
  const text = all.join(', ');
  const parts: string[] = [];
  const fuel = text.match(/(essence|diesel|hybride|[ée]lectrique)/i);
  const turbo = /turbo/i.test(text) || /\d[.,]\d\s*T\b/.test(text);
  if (fuel) parts.push(capitalize(fuel[1].toLowerCase()) + (turbo ? ' turbo' : ''));
  else if (turbo) parts.push('Turbo');
  const cyl = text.match(/(\d+)\s*cylindres?/i);
  if (cyl) parts.push(`${cyl[1]} cylindres`);
  const cc = text.match(/(\d[\d\s  ]*)\s*cm(?:³|3)/i);
  if (cc) parts.push(`${clean(cc[1]).replace(/[  ]/g, ' ')} cm³`);
  const power = text.match(/Puissance(?: maximale)?\s*:\s*([^,(]+ch)\b/i);
  if (power) parts.push(clean(power[1]));
  if (parts.length === 0) return null;
  return `Moteur : ${parts.join(', ')}`;
}

function gearboxLines(all: string[], transmission: string[]): string[] {
  const out: string[] = [];
  const candidates = [...transmission, ...all];
  let box: string | null = null;
  for (const line of candidates) {
    box = valueAfter(line, /Bo[iî]te de vitesses/i);
    if (box) break;
  }
  if (!box && transmission.length) {
    // Ex. "Automatique, 6 rapports (AT), Type de traction : 4x4"
    const first = transmission[0];
    const cut = first.search(/,?\s*Type de traction/i);
    box = clean(cut === -1 ? first : first.slice(0, cut));
  }
  if (box) out.push(`Boîte : ${capitalize(box)}`);
  for (const line of candidates) {
    const traction = valueAfter(line, /Type de traction/i);
    if (traction) {
      out.push(`Transmission : ${capitalize(traction)}`);
      break;
    }
  }
  return out;
}

function safetyLine(lines: string[]): string | null {
  const parts: string[] = [];
  for (const line of lines) {
    const airbags = valueAfter(line, /Airbags?/i);
    if (airbags !== null && /^airbag/i.test(line)) {
      parts.push(/^\d+$/.test(airbags) ? `${airbags} airbags` : `airbags ${airbags.toLowerCase()}`);
      continue;
    }
    const assist = valueAfter(line, /Syst[eè]mes? d'assistance/i);
    if (assist) {
      parts.push(assist);
      continue;
    }
    if (/contr[ôo]le de stabilit[ée]/i.test(line) && !parts.some((p) => /ESP/.test(p))) {
      parts.push('contrôle de stabilité');
      continue;
    }
    if (/cam[ée]ra de recul/i.test(line) && !/:\s*non/i.test(line)) {
      parts.push('caméra de recul');
      continue;
    }
  }
  if (parts.length === 0) return null;
  return `Sécurité : ${capitalize(parts.join(', '))}`;
}

function seatsLine(all: string[]): string | null {
  for (const line of all) {
    const m = line.match(/(\d+)\s*places/i);
    if (m) return `Places : ${m[1]}`;
  }
  return null;
}

// Extrait 4 à 6 lignes courtes d'une fiche technique. Renvoie un texte
// prêt à afficher (une ligne par caractéristique, préfixée par "- ").
export function shortSpecsFromDescription(description: string | null | undefined): string {
  if (!description || !description.trim()) return '';
  const sections = splitSections(description);
  const all = sections.flatMap((s) => s.lines);
  const bySection = (re: RegExp) => sections.filter((s) => re.test(s.title)).flatMap((s) => s.lines);

  const technical = bySection(/CARACT|MOTEUR|TECHNIQUE/i);
  const transmission = bySection(/TRANSMISSION|BO[IÎ]TE/i);
  const safety = bySection(/S[EÉ]CURIT/i);

  const result: string[] = [];
  const engine = engineLine(technical.length ? technical : all);
  if (engine) result.push(engine);
  result.push(...gearboxLines(all, transmission));
  const sec = safetyLine(safety.length ? safety : all);
  if (sec) result.push(sec);
  const seats = seatsLine(all);
  if (seats) result.push(seats);

  let lines = result.map((l) => l.replace(/\s+,/g, ',')).filter((l) => !isForbiddenSpecLine(l));

  // Fiche non structurée : on garde les premières lignes autorisées.
  if (lines.length < 2) {
    lines = all.map(clean).filter((l) => l && !isForbiddenSpecLine(l)).slice(0, 5);
  }
  return lines.slice(0, 6).map((l) => `- ${l}`).join('\n');
}

// Caractéristiques à imprimer : celles saisies sur la fiche produit, sinon
// l'extraction automatique. Les lignes interdites (litres, dimensions) sont
// retirées dans tous les cas.
export function resolveShortSpecs(shortSpecs: string | null | undefined, description: string | null | undefined): string {
  const manual = (shortSpecs ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !isForbiddenSpecLine(l));
  if (manual.length > 0) return manual.map((l) => (l.startsWith('-') ? l : `- ${l}`)).join('\n');
  return shortSpecsFromDescription(description);
}
