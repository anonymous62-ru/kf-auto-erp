// Découpe un texte de désignation multi-ligne (ex : la description d'un
// produit du catalogue, qui peut contenir des sections en MAJUSCULES suivies
// de puces "- ...", comme sur le modèle papier d'origine de KF Auto) en
// lignes typées, pour que PDF et DOCX puissent afficher les titres de
// section en gras et le reste normalement, au lieu d'aplatir le tout sur une
// seule ligne.
export interface DesignationLine {
  text: string;
  bold: boolean;
}

export function parseDesignationLines(raw: string): DesignationLine[] {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  return lines.map((line) => {
    const isBullet = line.startsWith('-') || line.startsWith('•');
    const letters = line.replace(/[^\p{L}]/gu, '');
    const isHeading = !isBullet && letters.length > 1 && line === line.toUpperCase() && line !== line.toLowerCase();
    return { text: line, bold: isHeading };
  });
}
