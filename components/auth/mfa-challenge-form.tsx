'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listTotpFactors, challengeAndVerifyLogin } from '@/lib/auth/mfa';

export function MfaChallengeForm() {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const factors = await listTotpFactors();
        const verified = factors.find((f) => f.status === 'verified');
        if (!verified) {
          // Pas de facteur vérifié : rien à demander, on continue normalement.
          router.replace('/dashboard');
          return;
        }
        setFactorId(verified.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [router]);

  async function handleVerify() {
    if (!factorId) return;
    setBusy(true);
    setError(null);
    try {
      await challengeAndVerifyLogin(factorId, code);
      router.replace('/dashboard');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Code invalide, réessaie.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-500">Chargement…</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Saisis le code à 6 chiffres généré par ton application d'authentification.</p>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        placeholder="123456"
        inputMode="numeric"
        autoFocus
        className="border rounded-md px-3 py-2 text-sm w-32 tracking-widest text-center"
      />
      <button
        onClick={handleVerify}
        disabled={busy || code.length !== 6}
        className="block w-full bg-kf-navy text-white rounded-md py-3 text-sm font-medium"
      >
        Valider
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
