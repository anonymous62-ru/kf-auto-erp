// Page PUBLIQUE (sans authentification), accessible en scannant le QR code
// imprimé sur un document PDF. Permet à un client ou une banque de vérifier
// l'authenticité d'un document sans avoir accès à l'app — n'affiche QUE le
// strict nécessaire (jamais les coordonnées du client ni le détail des lignes).
import { createAdminClient } from '@/lib/supabase/admin';
import { formatCFA } from '@/lib/documents/calculations';
import { IconCheck, IconX } from '@/components/icons';

const LABELS: Record<string, string> = {
  proforma: 'Proforma',
  devis: 'Devis',
  facture: 'Facture',
  bon_livraison: 'Bon de livraison',
  recu: 'Reçu',
  avoir: 'Avoir',
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  brouillon: { label: 'Brouillon (non finalisé)', color: 'bg-gray-100 text-gray-600' },
  envoye: { label: 'Envoyé, en attente de paiement', color: 'bg-amber-100 text-amber-700' },
  accepte: { label: 'Accepté', color: 'bg-blue-100 text-blue-700' },
  refuse: { label: 'Refusé', color: 'bg-red-100 text-red-700' },
  paye_partiel: { label: 'Partiellement payé', color: 'bg-amber-100 text-amber-700' },
  paye: { label: 'Payé', color: 'bg-green-100 text-green-700' },
  annule: { label: 'Annulé', color: 'bg-gray-200 text-gray-500' },
};

export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let document: {
    document_type: string;
    document_number: string | null;
    issue_date: string;
    total_amount: number;
    status: string;
    organization_id: string;
  } | null = null;

  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('documents')
      .select('document_type, document_number, issue_date, total_amount, status, organization_id')
      .eq('id', id)
      .maybeSingle();
    document = data;
  } catch {
    // configuration serveur manquante (clé service_role) : traité comme "introuvable" ci-dessous
  }

  let organizationName = 'KF Auto SARL';
  if (document) {
    try {
      const admin = createAdminClient();
      const { data: org } = await admin.from('organizations').select('name').eq('id', document.organization_id).maybeSingle();
      if (org?.name) organizationName = org.name;
    } catch {
      // garde le nom par défaut
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-xl border shadow-sm p-5 space-y-4">
        <div className="text-center space-y-1">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Vérification de document</p>
          <p className="font-medium text-kf-navy">{organizationName}</p>
        </div>

        {!document ? (
          <div className="text-center py-6">
            <p className="text-red-600 font-medium flex items-center justify-center gap-1.5">
              <IconX className="w-4 h-4" /> Document introuvable
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Ce document n&apos;existe pas ou a été supprimé. S&apos;il s&apos;agit d&apos;un document imprimé, contactez
              directement {organizationName}.
            </p>
          </div>
        ) : (
          <>
            <div className="text-center py-2">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-green-100 text-green-700">
                <IconCheck className="w-5 h-5" />
              </div>
              <p className="text-green-700 font-medium mt-1">Document authentique</p>
            </div>

            <div className="border rounded-lg divide-y text-sm">
              <div className="flex justify-between px-3 py-2">
                <span className="text-gray-500">Type</span>
                <span className="font-medium">{LABELS[document.document_type] ?? document.document_type}</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-gray-500">Numéro</span>
                <span className="font-medium">{document.document_number ?? '-'}</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-gray-500">Date</span>
                <span className="font-medium">{document.issue_date}</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-gray-500">Montant total</span>
                <span className="font-medium">{formatCFA(Number(document.total_amount))}</span>
              </div>
              <div className="flex justify-between px-3 py-2 items-center">
                <span className="text-gray-500">Statut</span>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    STATUS_LABELS[document.status]?.color ?? 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {STATUS_LABELS[document.status]?.label ?? document.status}
                </span>
              </div>
            </div>
          </>
        )}

        <p className="text-center text-xs text-gray-400">Émis via KF Auto ERP</p>
      </div>
    </div>
  );
}
