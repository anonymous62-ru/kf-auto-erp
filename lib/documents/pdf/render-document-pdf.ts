// Génération du PDF d'un document, partagée entre la route privée (employé
// connecté, accès contrôlé par la RLS) et la route publique (client final,
// accès par jeton, via la clé service_role).
import QRCode from 'qrcode';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildDocumentPdf, type PdfVehicle } from '@/lib/documents/pdf/build-pdf';
import { withVehicleNumbers } from '@/lib/documents/item-vehicles';
import { createAdminClient } from '@/lib/supabase/admin';
import { signatureDataUri } from '@/lib/signatures/storage';

export async function renderDocumentPdf(
  supabase: SupabaseClient,
  lookup: { column: 'id' | 'public_token'; value: string },
  origin: string
): Promise<{ buffer: Buffer; filename: string } | null> {
  const { data: document, error } = await supabase
    .from('documents')
    .select(
      `id, document_type, document_number, issue_date, due_date, subtotal, tax_amount, total_amount, status, notes,
       commercial_signature_url, client_signature_url, signed_at, n1_signature_url, n1_signed_by, n1_signed_at,
       organization_id, commercial_id, validated_by, workflow_status,
       commercial_signature_path, commercial_stamp_path, n1_signature_path, n1_stamp_path,
       clients (first_name, last_name, company_name, phone, address, email, client_number)`
    )
    .eq(lookup.column, lookup.value)
    .maybeSingle();

  if (error || !document) return null;

  const { data: organization } = await supabase
    .from('organizations')
    .select('name, logo_url, bank_name, bank_account, rccm, nif, cnss_number, address, phones, terms_and_conditions')
    .eq('id', document.organization_id)
    .single();

  const { data: commercial } = await supabase
    .from('profiles')
    .select('full_name, phone')
    .eq('id', document.commercial_id)
    .maybeSingle();

  const { data: rawItems } = await supabase
    .from('document_items')
    .select('id, product_id, designation, quantity, unit_price, line_total, short_specs_snapshot')
    .eq('document_id', document.id)
    .order('position');
  type RawItem = {
    id: string;
    product_id: string | null;
    designation: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    short_specs_snapshot?: string | null;
  };
  const items = (rawItems ?? []) as RawItem[];

  const isInvoiceLike = document.document_type === 'facture' || document.document_type === 'avoir';
  let pdfItems: Parameters<typeof buildDocumentPdf>[0]['items'];
  let vehicles: PdfVehicle[] = [];

  if (isInvoiceLike) {
    // Facture simplifiée : caractéristiques courtes du produit + tableau
    // d'identification des véhicules (au lieu du châssis ajouté à la
    // désignation, comme sur la proforma et le bon de commande).
    const productIds = [...new Set(items.map((i) => i.product_id).filter((v): v is string => !!v))];
    const { data: products } = productIds.length
      ? await supabase.from('products').select('id, designation, description, short_specs').in('id', productIds)
      : { data: [] as { id: string; designation: string; description: string | null; short_specs: string | null }[] };
    const byId = new Map((products ?? []).map((p) => [p.id, p]));
    pdfItems = items.map(({ short_specs_snapshot, ...i }) => {
      const p = i.product_id ? byId.get(i.product_id) : undefined;
      return {
        ...i,
        product_designation: p?.designation ?? null,
        product_description: p?.description ?? null,
        // Texte figé à l'émission en priorité : une facture émise ne change pas
        // si la fiche produit est modifiée ensuite.
        product_short_specs: short_specs_snapshot || p?.short_specs || null,
      };
    });
    vehicles = await loadInvoiceVehicles(supabase, document.id, items);
  } else {
    pdfItems = await withVehicleNumbers(supabase, document.id, items);
  }

  // Signataire N+1 (responsable commercial), affiché sur la proforma.
  let n1SignerName: string | null = null;
  if (document.n1_signed_by) {
    const { data: n1 } = await supabase.from('profiles').select('full_name').eq('id', document.n1_signed_by).maybeSingle();
    n1SignerName = n1?.full_name ?? null;
  }

  const client = Array.isArray(document.clients) ? document.clients[0] : document.clients;
  const images = await resolveSignatureImages(document);

  const verifyUrl = `${origin}/verify/${document.id}`;
  const qrCodeDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 0 });

  const buffer = await buildDocumentPdf({
    document: {
      document_type: document.document_type,
      document_number: document.document_number,
      issue_date: document.issue_date,
      due_date: document.due_date,
      subtotal: Number(document.subtotal || 0),
      tax_amount: Number(document.tax_amount || 0),
      total_amount: Number(document.total_amount || 0),
      status: document.status ?? null,
      reference_note: document.document_type === 'avoir' ? document.notes ?? null : null,
      commercial_signature_url: images.commercialSignature,
      client_signature_url: document.client_signature_url ?? null,
      client_signed_at: document.signed_at ?? null,
      n1_signature_url: images.n1Signature,
      commercial_stamp_url: images.commercialStamp,
      n1_stamp_url: images.n1Stamp,
      company_box_title: images.companyBoxTitle,
      n1_signer_name: n1SignerName,
      n1_signed_at: document.n1_signed_at ?? null,
    },
    organization: organization ?? { name: 'KF Auto SARL' },
    client: client ?? {},
    commercial: commercial ?? { full_name: '' },
    items: pdfItems,
    vehicles,
    qrCodeDataUrl,
  });

  return { buffer, filename: `${document.document_number ?? document.id}.pdf` };
}

// Véhicules rattachés aux lignes d'une facture (liens actifs), dans l'ordre
// des lignes : modèle, couleur, numéro de châssis, numéro moteur.
async function loadInvoiceVehicles(
  supabase: SupabaseClient,
  documentId: string,
  items: { id: string; designation: string }[]
): Promise<PdfVehicle[]> {
  const { data, error } = await supabase
    .from('document_item_vehicles')
    .select('document_item_id, created_at, vehicle_units (vin, color, engine_number, products (brand, model, designation))')
    .eq('document_id', documentId)
    .is('removed_at', null)
    .order('created_at');
  if (error || !data) return [];

  const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);
  const position = new Map(items.map((i, idx) => [i.id, idx]));
  type Row = {
    document_item_id: string;
    vehicle_units:
      | { vin: string | null; color: string | null; engine_number: string | null; products: unknown }
      | { vin: string | null; color: string | null; engine_number: string | null; products: unknown }[]
      | null;
  };
  return (data as Row[])
    .slice()
    .sort((a, b) => (position.get(a.document_item_id) ?? 0) - (position.get(b.document_item_id) ?? 0))
    .map((row) => {
      const unit = one(row.vehicle_units);
      const product = one(unit?.products as { brand: string | null; model: string | null; designation: string } | null);
      const item = items.find((i) => i.id === row.document_item_id);
      const model =
        [product?.brand, product?.model].filter(Boolean).join(' ') ||
        product?.designation ||
        (item?.designation.split('\n')[0] ?? '');
      return { model, color: unit?.color ?? null, vin: unit?.vin ?? null, engine_number: unit?.engine_number ?? null };
    })
    .filter((v) => v.vin || v.model);
}

// Signatures et cachets à imprimer (0055). L'accès au document a déjà été
// contrôlé (RLS de l'employé ou jeton public) : les chemins des signatures
// enregistrées et des cachets sont relus avec la clé service_role, car un
// commercial ne lit pas le profil des autres et la page publique n'a pas de
// session.
// - Proforma : uniquement ce qui a été figé à la soumission (commercial +
//   cachet service commercial) et à la validation (N+1 + cachet selon son
//   rôle). Une signature à la main reste prioritaire. Case client : vide si
//   le client n'a pas signé (signature au stylo).
// - Bon de commande : signature du commercial (à la main, sinon figée sur le
//   document, sinon sa signature enregistrée actuelle) + cachet service
//   commercial.
// - Facture / avoir émis : case « Signature et cachet de la société » avec
//   le cachet direction + la signature de la personne qui a validé la
//   facture (validated_by), sinon la signature à la main existante.
//   Rien tant que la facture est en préparation ou en validation.
type SignatureSource = {
  document_type: string;
  status?: string | null;
  workflow_status?: string | null;
  organization_id: string;
  commercial_id: string | null;
  validated_by?: string | null;
  commercial_signature_url?: string | null;
  n1_signature_url?: string | null;
  commercial_signature_path?: string | null;
  commercial_stamp_path?: string | null;
  n1_signature_path?: string | null;
  n1_stamp_path?: string | null;
};

async function resolveSignatureImages(doc: SignatureSource) {
  const type = doc.document_type;
  const isProforma = type === 'devis' || type === 'proforma';
  const isInvoiceLike = type === 'facture' || type === 'avoir';
  const result = {
    commercialSignature: (doc.commercial_signature_url ?? null) as string | null,
    n1Signature: (doc.n1_signature_url ?? null) as string | null,
    commercialStamp: null as string | null,
    n1Stamp: null as string | null,
    companyBoxTitle: null as string | null,
  };

  if (isProforma) {
    const [sig, stamp, n1Sig, n1Stamp] = await Promise.all([
      result.commercialSignature ? Promise.resolve(null) : signatureDataUri(doc.commercial_signature_path),
      signatureDataUri(doc.commercial_stamp_path),
      result.n1Signature ? Promise.resolve(null) : signatureDataUri(doc.n1_signature_path),
      signatureDataUri(doc.n1_stamp_path),
    ]);
    result.commercialSignature = result.commercialSignature ?? sig;
    result.commercialStamp = stamp;
    result.n1Signature = result.n1Signature ?? n1Sig;
    result.n1Stamp = n1Stamp;
    return result;
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return result;
  }
  const { data: org } = await admin
    .from('organizations')
    .select('stamp_commercial_path, stamp_direction_path')
    .eq('id', doc.organization_id)
    .maybeSingle();

  if (type === 'commande') {
    let sigPath = doc.commercial_signature_path ?? null;
    if (!result.commercialSignature && !sigPath && doc.commercial_id) {
      const { data: p } = await admin.from('profiles').select('signature_path').eq('id', doc.commercial_id).maybeSingle();
      sigPath = p?.signature_path ?? null;
    }
    const [sig, stamp] = await Promise.all([
      result.commercialSignature ? Promise.resolve(null) : signatureDataUri(sigPath),
      signatureDataUri(doc.commercial_stamp_path ?? org?.stamp_commercial_path),
    ]);
    result.commercialSignature = result.commercialSignature ?? sig;
    result.commercialStamp = stamp;
    return result;
  }

  if (isInvoiceLike) {
    const pending = ['en_preparation', 'en_attente_validation', 'refusee'].includes(doc.workflow_status ?? '');
    if (pending || doc.status === 'brouillon') return result;
    result.companyBoxTitle = 'Signature et cachet de la société';
    let sig: string | null = null;
    if (doc.validated_by) {
      const { data: p } = await admin.from('profiles').select('signature_path').eq('id', doc.validated_by).maybeSingle();
      sig = await signatureDataUri(p?.signature_path);
    }
    result.commercialSignature = sig ?? result.commercialSignature;
    result.commercialStamp = await signatureDataUri(org?.stamp_direction_path);
  }
  return result;
}
