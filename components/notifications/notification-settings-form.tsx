'use client';

import { useState } from 'react';
import { sendTestEmail, setEmailNonUrgent } from '@/lib/notifications/settings';

export function NotificationSettingsForm({
  initialNonUrgent,
  email,
  canTest,
}: {
  initialNonUrgent: boolean;
  email: string | null;
  canTest: boolean;
}) {
  const [nonUrgent, setNonUrgent] = useState(initialNonUrgent);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  async function toggle() {
    if (saving) return; // anti double-clic
    const next = !nonUrgent;
    setSaving(true);
    setMessage(null);
    setNonUrgent(next);
    const res = await setEmailNonUrgent(next);
    if (res.error) {
      setNonUrgent(!next);
      setMessage({ tone: 'err', text: res.error });
    } else {
      setMessage({ tone: 'ok', text: 'Réglage enregistré.' });
    }
    setSaving(false);
  }

  async function test() {
    if (testing) return; // anti double-clic
    setTesting(true);
    setMessage(null);
    const res = await sendTestEmail();
    setMessage(res.error ? { tone: 'err', text: res.error } : { tone: 'ok', text: `E-mail de test envoyé à ${res.to}.` });
    setTesting(false);
  }

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Recevoir les e-mails non urgents (informations, confirmations)</h2>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              Par exemple : proforma validée, facture émise, bon de commande conforme. Ces informations restent toujours
              visibles dans la cloche de l&apos;application.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={nonUrgent}
            aria-label="Recevoir les e-mails non urgents"
            onClick={toggle}
            disabled={saving}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
              nonUrgent ? 'bg-kf-navy' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                nonUrgent ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </section>

      <section className="card p-4 text-sm text-gray-700">
        <h2 className="text-sm font-semibold text-gray-900">Toujours envoyés</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-gray-600">
          <li>les demandes de validation ou d&apos;autorisation qui vous sont adressées ;</li>
          <li>les rappels après 24 h et 48 h (la direction est mise en copie après 48 h) ;</li>
          <li>le récapitulatif du matin de vos actions en attente.</li>
        </ul>
        <p className="mt-3 text-xs text-gray-500">
          Adresse utilisée : <span className="font-medium text-gray-700">{email ?? 'aucune adresse sur votre compte'}</span>. Les
          e-mails contiennent un lien vers l&apos;application : la connexion reste obligatoire et aucune validation n&apos;est
          possible depuis un e-mail.
        </p>
      </section>

      {canTest && (
        <section className="card p-4">
          <h2 className="text-sm font-semibold text-gray-900">Vérifier l&apos;envoi</h2>
          <p className="mt-1 text-xs text-gray-500">
            Envoie un e-mail de démonstration à votre propre adresse (réservé au super admin).
          </p>
          <button type="button" onClick={test} disabled={testing} className="btn-secondary btn-sm mt-3">
            {testing ? 'Envoi en cours...' : "M'envoyer un e-mail de test"}
          </button>
        </section>
      )}

      {message && (
        <p
          role="status"
          className={`rounded-lg border px-3 py-2 text-sm ${
            message.tone === 'ok' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
