// Génère le même document (proforma/devis/facture/BL/reçu/avoir) qu'en PDF,
// mais au format .docx éditable — même structure visuelle que
// DocumentTemplate.tsx (bandes de couleur, tableau lignes, totaux,
// conditions, signatures, pied de page), simplifiée pour Word.
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  ImageRun,
  BorderStyle,
  WidthType,
  ShadingType,
  AlignmentType,
} from 'docx';
import { formatCFA } from '@/lib/documents/calculations';
import { urlToImageBuffer } from '@/lib/documents/pdf/storage-to-data-uri';
import { parseDesignationLines } from '@/lib/documents/format-lines';

const LABELS: Record<string, string> = {
  proforma: 'PROFORMA',
  devis: 'DEVIS',
  facture: 'FACTURE',
  bon_livraison: 'BON DE LIVRAISON',
  recu: 'REÇU',
  avoir: 'AVOIR',
};

// Même garde-fou que côté PDF : jamais un objet brut inséré dans un TextRun.
function t(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '';
}

interface Item {
  designation: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

interface Props {
  document: {
    document_type: string;
    document_number: string | null;
    issue_date: string;
    due_date: string | null;
    subtotal: number;
    tax_amount: number;
    total_amount: number;
    status?: string | null;
    commercial_signature_url?: string | null;
    client_signature_url?: string | null;
  };
  organization: {
    name: string;
    logo_url?: string | null;
    bank_name?: string | null;
    bank_account?: string | null;
    rccm?: string | null;
    nif?: string | null;
    cnss_number?: string | null;
    address?: string | null;
    phones?: string | null;
    terms_and_conditions?: string | null;
  };
  client: {
    first_name?: string | null;
    last_name?: string | null;
    company_name?: string | null;
    phone?: string | null;
    address?: string | null;
    email?: string | null;
  };
  commercial: { full_name: string; phone?: string | null };
  items: Item[];
}

const PAGE_WIDTH_DXA = 11907; // A4 en twips (portrait)
const MARGIN_DXA = 850;
const CONTENT_WIDTH_DXA = PAGE_WIDTH_DXA - MARGIN_DXA * 2;

const NAVY = '1B2A4A';
const RED = 'C1272D';
const ORANGE = 'F7941D';
const BLACK = '000000';

function colorBars(): Table {
  const w = Math.floor(CONTENT_WIDTH_DXA / 7);
  const seg = (color: string, span: number) =>
    new TableCell({
      width: { size: w * span, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: color },
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      },
      children: [new Paragraph({ children: [new TextRun({ text: ' ', size: 4 })] })],
    });
  return new Table({
    width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: [w * 2, w, w * 3, w],
    rows: [new TableRow({ children: [seg(RED, 2), seg(ORANGE, 1), seg(NAVY, 3), seg(BLACK, 1)] })],
  });
}

function infoCell(text: string, header: boolean, widthDxa: number, lastInRow: boolean): TableCell {
  return new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: NAVY } : undefined,
    borders: {
      right: lastInRow
        ? { style: BorderStyle.NONE, size: 0, color: 'auto' }
        : { style: BorderStyle.SINGLE, size: 4, color: BLACK },
    },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: header, color: header ? 'FFFFFF' : undefined, size: 16 })],
      }),
    ],
  });
}

function itemsCell(text: string, widthDxa: number, header: boolean, bold = false): TableCell {
  return new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: NAVY } : undefined,
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: header || bold, color: header ? 'FFFFFF' : undefined, size: 16 })],
      }),
    ],
  });
}

// Cellule "Description" dédiée : le texte peut être multi-ligne (les
// caractéristiques d'un produit du catalogue, avec des titres de section en
// MAJUSCULES suivis de puces "-", comme sur le modèle papier d'origine) — un
// paragraphe par ligne, avec les titres en gras, au lieu d'aplatir le tout
// sur une seule ligne.
function itemsDesignationCell(text: string, widthDxa: number): TableCell {
  const lines = parseDesignationLines(text);
  const paragraphs =
    lines.length > 0
      ? lines.map(
          (line, i) =>
            new Paragraph({
              spacing: { after: i === lines.length - 1 ? 0 : 20 },
              children: [new TextRun({ text: line.text, bold: line.bold, size: 16 })],
            })
        )
      : [new Paragraph({ children: [new TextRun({ text, size: 16 })] })];
  return new TableCell({ width: { size: widthDxa, type: WidthType.DXA }, children: paragraphs });
}

export async function buildDocumentDocx({ document, organization, client, commercial, items }: Props): Promise<Buffer> {
  const clientName = t(client.company_name) || `${t(client.first_name)} ${t(client.last_name)}`.trim();

  const [logo, commercialSig, clientSig] = await Promise.all([
    urlToImageBuffer(organization.logo_url),
    urlToImageBuffer(document.commercial_signature_url),
    urlToImageBuffer(document.client_signature_url),
  ]);

  const infoColWidth = Math.floor(CONTENT_WIDTH_DXA / 4);

  const itemsColWidths = [
    Math.floor(CONTENT_WIDTH_DXA * 0.4),
    Math.floor(CONTENT_WIDTH_DXA * 0.15),
    Math.floor(CONTENT_WIDTH_DXA * 0.225),
    Math.floor(CONTENT_WIDTH_DXA * 0.225),
  ];

  const children: (Paragraph | Table)[] = [
    colorBars(),
    new Paragraph({ text: '', spacing: { after: 100 } }),
  ];

  // En-tête : logo (ou nom) + coordonnées client
  if (logo) {
    children.push(
      new Paragraph({
        children: [new ImageRun({ data: logo.buffer, type: logo.type, transformation: { width: 130, height: 60 } })],
      })
    );
  } else {
    children.push(
      new Paragraph({ children: [new TextRun({ text: t(organization.name) || 'KF Auto SARL', bold: true, size: 28 })] })
    );
  }
  children.push(
    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `Client : ${clientName}`, size: 18 })] }),
    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `Tél : ${t(client.phone)}`, size: 18 })] }),
    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `Adresse : ${t(client.address)}`, size: 18 })] }),
    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `E-mail : ${t(client.email)}`, size: 18 })] }),
    new Paragraph({ text: '', spacing: { after: 150 } })
  );

  // Titre du document
  const label = t(LABELS[document.document_type] ?? document.document_type);
  const number = t(document.document_number) || '(en attente de synchronisation)';
  children.push(
    new Paragraph({
      // Pas de "heading:" ici : le style Word "Titre 2" impose sa propre
      // couleur de thème (bleu, souvent souligné) qui écrasait le noir gras
      // voulu — même souci visuel que sur le modèle papier d'origine.
      children: [new TextRun({ text: `${label} N° : ${number}`, bold: true, size: 22, color: BLACK })],
      spacing: { after: 150 },
    })
  );

  // Tableau infos (date / échéance / vendeur / numéro vendeur)
  children.push(
    new Table({
      width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
      columnWidths: [infoColWidth, infoColWidth, infoColWidth, infoColWidth],
      rows: [
        new TableRow({
          children: [
            infoCell('Date', true, infoColWidth, false),
            infoCell('Échéance', true, infoColWidth, false),
            infoCell('Nom du vendeur', true, infoColWidth, false),
            infoCell('Numéro du vendeur', true, infoColWidth, true),
          ],
        }),
        new TableRow({
          children: [
            infoCell(t(document.issue_date), false, infoColWidth, false),
            infoCell(t(document.due_date) || '-', false, infoColWidth, false),
            infoCell(t(commercial.full_name), false, infoColWidth, false),
            infoCell(t(commercial.phone), false, infoColWidth, true),
          ],
        }),
      ],
    }),
    new Paragraph({ text: '', spacing: { after: 150 } })
  );

  // Tableau des lignes + totaux
  const itemRows = items.map(
    (item) =>
      new TableRow({
        children: [
          itemsDesignationCell(t(item.designation), itemsColWidths[0]),
          itemsCell(Number(item.quantity || 0).toFixed(2), itemsColWidths[1], false),
          itemsCell(formatCFA(Number(item.unit_price || 0)), itemsColWidths[2], false),
          itemsCell(formatCFA(Number(item.line_total || 0)), itemsColWidths[3], false),
        ],
      })
  );

  children.push(
    new Table({
      width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
      columnWidths: itemsColWidths,
      rows: [
        new TableRow({
          children: [
            itemsCell('Description', itemsColWidths[0], true),
            itemsCell('Qté', itemsColWidths[1], true),
            itemsCell('PU hors taxes', itemsColWidths[2], true),
            itemsCell('Montant hors taxes', itemsColWidths[3], true),
          ],
        }),
        ...itemRows,
        new TableRow({
          children: [
            itemsCell('Prix HT', itemsColWidths[0] + itemsColWidths[1], false, true),
            itemsCell(formatCFA(Number(document.subtotal || 0)), itemsColWidths[2] + itemsColWidths[3], false, true),
          ],
        }),
        new TableRow({
          children: [
            itemsCell('TVA', itemsColWidths[0] + itemsColWidths[1], false, true),
            itemsCell(
              Number(document.tax_amount || 0) > 0 ? formatCFA(Number(document.tax_amount)) : 'NA',
              itemsColWidths[2] + itemsColWidths[3],
              false,
              true
            ),
          ],
        }),
        new TableRow({
          children: [
            itemsCell('Montant total net', itemsColWidths[0] + itemsColWidths[1], false, true),
            itemsCell(formatCFA(Number(document.total_amount || 0)), itemsColWidths[2] + itemsColWidths[3], false, true),
          ],
        }),
      ],
    }),
    new Paragraph({ text: '', spacing: { after: 150 } })
  );

  // Conditions générales : affichées tant que le document n'est pas
  // intégralement payé (même règle que côté PDF).
  const isPaid = t(document.status) === 'paye';
  if (!isPaid && t(organization.terms_and_conditions)) {
    // Une Paragraph par ligne d'origine : un seul TextRun ne rend pas les
    // "\n" internes (Word les affiche comme du texte plat sur une seule
    // ligne), ce qui fondait toutes les conditions (une par tiret) en un
    // bloc continu au lieu de les garder une par ligne.
    const termsLines = t(organization.terms_and_conditions)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    children.push(
      new Paragraph({ children: [new TextRun({ text: 'CONDITIONS GÉNÉRALES', bold: true, size: 16 })] }),
      ...termsLines.map(
        (line, i) =>
          new Paragraph({
            children: [new TextRun({ text: line, size: 14 })],
            spacing: i === termsLines.length - 1 ? { after: 150 } : undefined,
          })
      )
    );
  }

  // Signatures
  const sigRowChildren: TableCell[] = [
    new TableCell({
      width: { size: Math.floor(CONTENT_WIDTH_DXA / 2), type: WidthType.DXA },
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      },
      children: [
        new Paragraph({ children: [new TextRun({ text: 'Signature commerciale', size: 14 })], spacing: { after: 60 } }),
        commercialSig
          ? new Paragraph({
              children: [new ImageRun({ data: commercialSig.buffer, type: commercialSig.type, transformation: { width: 100, height: 40 } })],
            })
          : new Paragraph({ text: '' }),
      ],
    }),
    new TableCell({
      width: { size: Math.floor(CONTENT_WIDTH_DXA / 2), type: WidthType.DXA },
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      },
      children: [
        new Paragraph({ children: [new TextRun({ text: 'Signature du client', size: 14 })], spacing: { after: 60 } }),
        clientSig
          ? new Paragraph({
              children: [new ImageRun({ data: clientSig.buffer, type: clientSig.type, transformation: { width: 100, height: 40 } })],
            })
          : new Paragraph({ text: '' }),
      ],
    }),
  ];
  children.push(
    new Table({
      width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
      columnWidths: [Math.floor(CONTENT_WIDTH_DXA / 2), Math.floor(CONTENT_WIDTH_DXA / 2)],
      rows: [new TableRow({ children: sigRowChildren })],
    }),
    new Paragraph({ text: '', spacing: { after: 150 } })
  );

  // Pied de page (répété simplement en bas du contenu — DOCX gère le vrai
  // footer de page différemment, superflu pour un document commercial court)
  // Logo rappelé ici comme sur le modèle papier, avant les coordonnées.
  const footerParts = [
    t(organization.bank_name),
    t(organization.bank_account),
    t(organization.rccm) ? `N° RCCM : ${t(organization.rccm)}` : '',
    t(organization.nif) ? `NIF : ${t(organization.nif)}` : '',
    t(organization.cnss_number) ? `N°CNSS : ${t(organization.cnss_number)}` : '',
  ].filter(Boolean);
  if (logo) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: BLACK, space: 4 } },
        children: [new ImageRun({ data: logo.buffer, type: logo.type, transformation: { width: 36, height: 16 } })],
      })
    );
  }
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: footerParts.join(', '), size: 12 })],
      border: logo ? undefined : { top: { style: BorderStyle.SINGLE, size: 4, color: BLACK, space: 4 } },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `${t(organization.name)} ${t(organization.address)} ${t(organization.phones)}`, size: 12 })],
    }),
    colorBars()
  );

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH_DXA, height: 16839 },
            margin: { top: MARGIN_DXA, bottom: MARGIN_DXA, left: MARGIN_DXA, right: MARGIN_DXA },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
