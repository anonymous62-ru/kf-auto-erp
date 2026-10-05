'use client';

import { useState } from 'react';
import { formatCFA } from '@/lib/documents/calculations';
import { recordSending } from '@/lib/documents/actions';
import { toWhatsappNumber } from '@/lib/utils/phone';

// Affiché juste après l'enregistrement d'un paiement (même partiel) : permet
// d'envoyer immédiatement un reçu au client par WhatsApp ou email, avec le
// montant payé et, s'il en reste, le solde restant clairement indiqué —
// reprend le même mécanisme (lien wa.me / Gmail + recordSending) que
// SendActions, plutôt que de générer un nouveau document PDF de reçu.
export function ReceiptSendActions({
  documentId,
  publicToken,
  documentNumber,
  amountPaid,
  balanceDue,
  clientPhone,
  clientEmail,
  onDismiss,
}: {
  documentId: string;
  publicToken: string;
  documentNumber: string | null;
  amountPaid: number;
  balanceDue: number;
  clientPhone?: string | null;
  clientEmail?: string | null;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pdfUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/public/documents/${publicToken}/pdf` : '';
  const soldeLine =
    balanceDue > 0
      ? `Solde restant : ${formatCFA(balanceDue)}.`
      : 'Ce document est intégralement soldé, merci !';
  const receiptText =
    `Bonjour, nous confirmons la réception de votre paiement de ${formatCFA(amountPaid)} ` +
    `pour le document ${documentNumber ?? ''} de KF Auto. ${soldeLine} Reçu : ${pdfUrl}`;

  async function handleWhatsApp() {
    if (!clientPhone) {
      setMessage("Ce client n'a pas de numéro de téléphone enregistré.");
      return;
    }
    const cleanPhone = toWhatsappNumber(clientPhone);
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(receiptText)}`, '_blank');
    setBusy(true);
    try {
      await recordSending({ documentId, channel: 'whatsapp', recipient: clientPhone });
      setMessage('Reçu envoyé via WhatsApp.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  async function handleEmail() {
    if (!clientEmail) {
      setMessage("Ce client n'a pas d'email enregistré.");
      return;
    }
    const gmailComposeUrl =
      `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(clientEmail)}` +
      `&su=${encodeURIComponent(`Reçu de paiement - ${documentNumber ?? ''}`)}` +
      `&body=${encodeURIComponent(receiptText)}`;
    window.open(gmailComposeUrl, '_blank');
    setBusy(true);
    try {
      await recordSending({ documentId, channel: 'email', recipient: clientEmail });
      setMessage('Reçu envoyé par email.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-green-200 bg-green-50 rounded-md p-3 space-y-2">
      <p className="text-sm text-green-800">
        Paiement de {formatCFA(amountPaid)} enregistré. {balanceDue > 0 ? `Reste ${formatCFA(balanceDue)}.` : 'Solde à zéro.'}
      </p>
      <p className="text-xs text-green-700">Envoyer le reçu au client ?</p>
      <div className="flex gap-2">
        <button
          onClick={handleWhatsApp}
          disabled={busy}
          className="flex-1 rounded-md bg-green-600 text-white text-sm font-medium py-2 disabled:opacity-60"
        >
          WhatsApp
        </button>
        <button onClick={handleEmail} disabled={busy} className="flex-1 border border-green-600 text-green-700 rounded-md py-2 text-sm">
          Email
        </button>
      </div>
      {message && <p className="text-xs text-green-700">{message}</p>}
      <button onClick={onDismiss} className="text-xs text-gray-400 underline">
        Ne pas envoyer
      </button>
    </div>
  );
}
