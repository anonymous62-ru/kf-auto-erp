'use client';

import { useEffect, useState } from 'react';
import { listTotpFactors, enrollTotp, verifyTotpEnrollment, unenrollTotp } from '@/lib/auth/mfa';
import { IconCheck } from '@/components/icons';

type Factor = { id: string; status: string; friendly_name?: string | null };

export function MfaSettings() {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrolling, setEnrolling] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    try {
      const list = await listTotpFactors();
      setFactors(list);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Erreur');
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const verifiedFactor = factors?.find((f) => f.status === 'verified');

  async function handleStartEnroll() {
    setBusy(true);
    setMessage(null);
    try {
      const data = await enrollTotp();
      setEnrolling({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    if (!enrolling) return;
    setBusy(true);
    setMessage(null);
    try {
      await verifyTotpEnrollment(enrolling.factorId, code);
      setEnrolling(null);
      setCode('');
      setMessage('Vérification en deux étapes activée.');
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Code invalide, réessaie.');
    } finally {
      setBusy(false);
    }
  }

  async function handleUnenroll(factorId: string) {
    if (!confirm('Désactiver la vérification en deux étapes ?')) return;
    setBusy(true);
    setMessage(null);
    try {
      await unenrollTotp(factorId);
      setMessage('Vérification en deux étapes désactivée.');
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  if (factors === null) {
    return <p className="text-sm text-gray-500">Chargement…</p>;
  }

  return (
    <div className="bg-white rounded-lg border p-4 space-y-3">
      <h2 className="text-sm font-medium">Vérification en deux étapes (2FA)</h2>
      <p className="text-xs text-gray-500">
        Recommandée pour les comptes Super Admin et Administrateur : un code généré par une application
        d'authentification (Google Authenticator, Authy…) sera demandé à chaque connexion.
      </p>

      {verifiedFactor ? (
        <div className="space-y-2">
          <p className="text-sm text-green-700 flex items-center gap-1.5"><IconCheck className="w-4 h-4" /> Activée</p>
          <button
            onClick={() => handleUnenroll(verifiedFactor.id)}
            disabled={busy}
            className="text-xs border border-red-600 text-red-600 rounded-md px-3 py-2"
          >
            Désactiver la 2FA
          </button>
        </div>
      ) : enrolling ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-600">
            Scanne ce QR code avec ton application d'authentification, puis saisis le code à 6 chiffres généré.
          </p>
          {/* qr_code est un SVG en data URI renvoyé directement par Supabase */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrolling.qrCode} alt="QR code 2FA" className="w-40 h-40 border rounded-md" />
          <p className="text-[10px] text-gray-400 break-all">Code manuel : {enrolling.secret}</p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            inputMode="numeric"
            className="border rounded-md px-3 py-2 text-sm w-32 tracking-widest text-center"
          />
          <div className="flex gap-2">
            <button
              onClick={handleVerify}
              disabled={busy || code.length !== 6}
              className="bg-kf-navy text-white rounded-md px-3 py-2 text-xs"
            >
              Vérifier et activer
            </button>
            <button
              onClick={() => {
                setEnrolling(null);
                setCode('');
              }}
              className="border rounded-md px-3 py-2 text-xs"
            >
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={handleStartEnroll}
          disabled={busy}
          className="bg-kf-navy text-white rounded-md px-3 py-2 text-xs"
        >
          Activer la 2FA
        </button>
      )}

      {message && <p className="text-xs text-gray-500">{message}</p>}
    </div>
  );
}
