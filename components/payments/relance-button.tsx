'use client';

import { useState } from 'react';
import { markReminderSent } from '@/lib/payments/actions';

export function RelanceButton({
  documentId,
  documentNumber,
  balanceDue,
  clientPhone,
  clientEmail,
}: {
  documentId: string;
  documentNumber: string | null;
  balanceDue: number;
  clientPhone?: string | null;
  clientEmail?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const text = `Bonjour, un rappel concernant le document ${documentNumber ?? ''} : un solde de ${Math.round(
    balanceDue
  )} FCFA reste dû. Merci de bien vouloir régulariser. Cordialement, KF Auto.`;

  async function afterSend() {
    setBusy(true);
    try {
      await markReminderSent(documentId);
      setMessage('Relance envoyée.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  function handleWhatsApp(e: React.MouseEvent) {
    e.preventDefault();
    if (!clientPhone) {
      setMessage('Pas de numéro enregistré pour ce client.');
      return;
    }
    window.open(`https://wa.me/${clientPhone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`, '_blank');
    void afterSend();
  }

  function handleEmail(e: React.MouseEvent) {
    e.preventDefault();
    if (!clientEmail) {
      setMessage('Pas d\'email enregistré pour ce client.');
      return;
    }
    // Gmail (webmail) plutôt que "mailto:" : ce dernier ne marche que si une
    // messagerie de bureau est configurée par défaut sur l'ordinateur, ce qui
    // ouvrait un onglet vide au lieu de composer un email.
    const gmailComposeUrl =
      `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(clientEmail)}` +
      `&su=${encodeURIComponent('Rappel de paiement')}&body=${encodeURIComponent(text)}`;
    window.open(gmailComposeUrl, '_blank');
    void afterSend();
  }

  return (
    <div className="flex items-center gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={handleWhatsApp}
        disabled={busy}
        className="text-xs bg-green-600 text-white rounded-md px-2 py-1"
      >
        Relancer (WhatsApp)
      </button>
      <button
        onClick={handleEmail}
        disabled={busy}
        className="text-xs border border-kf-navy text-kf-navy rounded-md px-2 py-1"
      >
        Email (Gmail)
      </button>
      {message && <span className="text-[10px] text-gray-500">{message}</span>}
    </div>
  );
}
