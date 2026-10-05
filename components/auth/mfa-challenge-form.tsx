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
    <div className="space-y-4">
      <div>
        <label htmlFor="mfa-code" className="block text-sm font-medium text-gray-700">
          Code de vérification
        </label>
        <input
          id="mfa-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          className="input mt-1.5 h-12 text-center text-lg tracking-[0.5em] num"
        />
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <button onClick={handleVerify} disabled={busy || code.length !== 6} className="btn-primary h-11 w-full">
        {busy ? 'Vérification...' : 'Valider'}
      </button>
    </div>
  );
}
