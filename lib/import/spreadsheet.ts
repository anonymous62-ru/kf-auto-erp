// Lecture de fichiers Excel (.xlsx) et CSV directement dans le navigateur,
// sans dépendance externe : un .xlsx est une archive ZIP de fichiers XML,
// qu'on décompresse avec l'API native DecompressionStream puis qu'on lit
// avec DOMParser. On évite ainsi d'ajouter la librairie "xlsx" de npm, dont
// la version publiée a des failles connues non corrigées.
//
// Le fichier ne quitte jamais le téléphone/l'ordinateur : seules les lignes
// validées par l'utilisateur sont envoyées au serveur à la fin.

export interface Sheet {
  name: string;
  rows: string[][];
}

export async function readSpreadsheet(file: File): Promise<Sheet[]> {
  const name = file.name.toLowerCase();
  const buffer = await file.arrayBuffer();
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const rows = parseCsv(decodeText(buffer));
    if (rows.length > MAX_ROWS) throw new Error(`Le fichier contient plus de ${MAX_ROWS} lignes. Découpez-le en plusieurs parties.`);
    return [{ name: file.name.replace(/\.(csv|txt)$/i, ''), rows }];
  }
  if (name.endsWith('.xls')) {
    throw new Error(
      "Ancien format Excel (.xls) non pris en charge. Ouvrez le fichier dans Excel et enregistrez-le en .xlsx (ou en CSV), puis réessayez."
    );
  }
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("Ce fichier n'est pas un classeur Excel (.xlsx) valide.");
  }
  return readXlsx(bytes);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
function decodeText(buffer: ArrayBuffer) {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  // Un CSV enregistré par Excel en français est souvent en Windows-1252 :
  // les accents y apparaissent comme des caractères de remplacement en UTF-8.
  if (utf8.includes('�')) return new TextDecoder('windows-1252').decode(buffer);
  return utf8.replace(/^﻿/, '');
}

export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', ',', '\t'].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim()));
}

// ---------------------------------------------------------------------------
// ZIP (lecture du répertoire central)
// ---------------------------------------------------------------------------
interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  offset: number;
}

// Garde-fous contre un fichier piégé (archive qui se décompresse en
// plusieurs Go et bloquerait le téléphone) ou démesuré.
const MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024;
const MAX_ROWS = 20000;

function listZip(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Classeur Excel illisible (archive incomplète).');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    entries.set(name, { name, method, compressedSize, uncompressedSize, offset });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nameLength = view.getUint16(entry.offset + 26, true);
  const extraLength = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLength + extraLength;
  const data = bytes.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error('Compression du classeur non prise en charge.');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------
async function readXlsx(bytes: Uint8Array): Promise<Sheet[]> {
  const zip = listZip(bytes);
  let total = 0;
  for (const entry of zip.values()) total += entry.uncompressedSize;
  if (total > MAX_UNCOMPRESSED_BYTES) {
    throw new Error('Classeur trop volumineux une fois décompressé. Enregistrez seulement l\'onglet utile en CSV, puis réessayez.');
  }
  const read = async (path: string) => {
    const entry = zip.get(path);
    return entry ? readEntry(bytes, entry) : null;
  };
  const parser = new DOMParser();
  const xml = (s: string) => parser.parseFromString(s, 'application/xml');

  const workbookXml = await read('xl/workbook.xml');
  if (!workbookXml) throw new Error("Ce fichier n'est pas un classeur Excel (.xlsx) valide.");
  const relsXml = await read('xl/_rels/workbook.xml.rels');

  const targets = new Map<string, string>();
  if (relsXml) {
    for (const rel of Array.from(xml(relsXml).getElementsByTagName('Relationship'))) {
      const target = rel.getAttribute('Target') ?? '';
      const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
      targets.set(rel.getAttribute('Id') ?? '', path);
    }
  }

  const shared: string[] = [];
  const sharedXml = await read('xl/sharedStrings.xml');
  if (sharedXml) {
    for (const si of Array.from(xml(sharedXml).getElementsByTagName('si'))) {
      // Texte éventuellement découpé en plusieurs "runs" (mise en forme mixte).
      shared.push(
        Array.from(si.getElementsByTagName('t'))
          .map((t) => t.textContent ?? '')
          .join('')
      );
    }
  }

  const sheets: Sheet[] = [];
  for (const sheetEl of Array.from(xml(workbookXml).getElementsByTagName('sheet'))) {
    const name = sheetEl.getAttribute('name') ?? `Feuille ${sheets.length + 1}`;
    const rid =
      sheetEl.getAttribute('r:id') ??
      sheetEl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ??
      '';
    const path = targets.get(rid) ?? `xl/worksheets/sheet${sheets.length + 1}.xml`;
    const sheetXml = await read(path);
    if (!sheetXml) continue;
    const rows = parseSheet(xml(sheetXml), shared);
    if (rows.length > MAX_ROWS) {
      throw new Error(`L'onglet "${name}" contient plus de ${MAX_ROWS} lignes. Découpez le fichier en plusieurs parties.`);
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

function columnIndex(ref: string) {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(doc: Document, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowEl of Array.from(doc.getElementsByTagName('row'))) {
    const rowIndex = Number(rowEl.getAttribute('r') ?? rows.length + 1) - 1;
    const row: string[] = [];
    for (const c of Array.from(rowEl.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r');
      const col = ref ? columnIndex(ref) : row.length;
      const type = c.getAttribute('t');
      let value = '';
      if (type === 'inlineStr') {
        value = Array.from(c.getElementsByTagName('t'))
          .map((t) => t.textContent ?? '')
          .join('');
      } else {
        const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
        if (type === 's') value = shared[Number(v)] ?? '';
        else if (type === 'b') value = v === '1' ? 'Oui' : 'Non';
        else value = v;
      }
      row[col] = value.trim();
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
    while (rows.length < rowIndex) rows.push([]);
    rows[rowIndex] = row;
  }
  return rows;
}
