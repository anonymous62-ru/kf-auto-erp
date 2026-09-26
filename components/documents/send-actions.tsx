'use client';

import { useState } from 'react';
import { recordSending } from '@/lib/documents/actions';

export function SendActions({
  documentId,
  documentNumber,
  clientPhone,
  clientEmail,
}: {
  documentId: string;
  documentNumber: string | null;
  clientPhone?: string | null;
  clientEmail?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pdfUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/documents/${documentId}/pdf` : '';
  const waText = `Bonjour, voici votre document ${documentNumber ?? ''} de KF Auto : ${pdfUrl}`;

  async function handleWhatsApp() {
    if (!clientPhone) {
      setMessage("Ce client n'a pas de numéro de téléphone enregistré.");
      return;
    }
    const cleanPhone = clientPhone.replace(/\D/g, '');
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(waText)}`, '_blank');
    setBusy(true);
    try {
      await recordSending({ documentId, channel: 'whatsapp', recipient: clientPhone });
      setMessage('Marqué comme envoyé via WhatsApp.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  async function handleEmailFallback() {
    if (!clientEmail) {
      setMessage("Ce client n'a pas d'email enregistré.");
      return;
    }
    // "mailto:" ne fonctionne que si l'ordinateur a une messagerie de bureau
    // configurée par défaut (Outlook, Mail...) — rarement le cas, et cela
    // ouvre alors un onglet vide au lieu de composer un email. On ouvre à la
    // place directement Gmail (webmail), qui marche dans n'importe quel
    // navigateur sans configuration, avec le sujet et le message déjà remplis.
    const gmailComposeUrl =
      `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(clientEmail)}` +
      `&su=${encodeURIComponent(`Votre document ${documentNumber ?? ''}`)}` +
      `&body=${encodeURIComponent(waText)}`;
    window.open(gmailComposeUrl, '_blank');
    setBusy(true);
    try {
      await recordSending({ documentId, channel: 'email', recipient: clientEmail });
      setMessage('Marqué comme envoyé par email.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 space-y-2">
      <p className="field-label uppercase tracking-wide">Envoyer au client</p>
      <div className="flex gap-2">
        <button
          onClick={handleWhatsApp}
          disabled={busy}
          className="flex-1 rounded-xl bg-green-600 text-white text-sm font-medium py-2.5 shadow-sm transition-colors hover:bg-green-700 disabled:opacity-60"
        >
          WhatsApp
        </button>
        <button onClick={handleEmailFallback} disabled={busy} className="btn-secondary flex-1 !py-2.5">
          Email (Gmail)
        </button>
      </div>
      {message && <p className="text-xs text-gray-500">{message}</p>}
      <p className="text-[10px] text-gray-400">
        Note test : le lien PDF pointe vers localhost, donc il ne s'ouvrira que sur ton propre réseau tant que
        l'app n'est pas en ligne (Vercel).
      </p>
    </div>
  );
}
