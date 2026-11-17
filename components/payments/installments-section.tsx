import { createClient } from '@/lib/supabase/server';
import { getInstallments, getUnconfirmedPayments } from '@/lib/payments/actions';
import { InstallmentsTable } from '@/components/payments/installments-table';
import { hasPermission } from '@/lib/permissions';

// Rôles qui saisissent un paiement (mêmes règles qu'en base :
// can_record_payment) ; le commercial du document en fait aussi partie.
const PAYMENT_ROLES = ['super_admin', 'administrateur', 'comptable', 'manager', 'receptionniste_sav'];

// Onglet Paiements de la fiche facture : échéancier + paiements à confirmer.
export async function InstallmentsSection({
  documentId,
  documentNumber,
  documentType,
  commercialId,
  balanceDue,
  clientPhone,
  clientEmail,
}: {
  documentId: string;
  documentNumber: string | null;
  documentType: string;
  commercialId: string | null;
  balanceDue: number;
  clientPhone?: string | null;
  clientEmail?: string | null;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user?.id ?? '').maybeSingle();
  const role = (me?.role as string | undefined) ?? '';

  // Confirmation des paiements : droit confirmer_paiement de la matrice (0058).
  const [installments, unconfirmed, canConfirm] = await Promise.all([
    documentType === 'facture' ? getInstallments(documentId) : Promise.resolve([]),
    getUnconfirmedPayments(documentId),
    hasPermission('confirmer_paiement'),
  ]);

  if (installments.length === 0 && unconfirmed.length === 0 && (documentType !== 'facture' || balanceDue <= 0)) {
    return null;
  }

  return (
    <InstallmentsTable
      documentId={documentId}
      documentNumber={documentNumber}
      isInvoice={documentType === 'facture'}
      balanceDue={balanceDue}
      installments={installments}
      unconfirmed={unconfirmed}
      canEditSchedule={PAYMENT_ROLES.includes(role) || (!!user && user.id === commercialId)}
      canConfirm={canConfirm}
      clientPhone={clientPhone}
      clientEmail={clientEmail}
    />
  );
}
