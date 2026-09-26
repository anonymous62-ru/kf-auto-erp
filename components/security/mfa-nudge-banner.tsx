'use client';

import { useEffect, useState } from 'react';
import { listTotpFactors } from '@/lib/auth/mfa';

// Bannière discrète incitant les comptes à privilèges élevés à activer la
// 2FA — non bloquante (on évite tout risque de blocage d'accès en cas de
// perte de téléphone) : le middleware, lui, applique l'obligation dès
// qu'un facteur est effectivement activé (voir middleware.ts).
export function MfaNudgeBanner({ role }: { role: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!['super_admin', 'administrateur'].includes(role)) return;
    listTotpFactors()
      .then((factors) => {
        if (!factors.some((f) => f.status === 'verified')) setShow(true);
      })
      .catch(() => {});
  }, [role]);

  if (!show) return null;

  return (
    <a
      href="/settings/security"
      className="block bg-amber-50 border border-amber-300 text-amber-800 rounded-lg p-3 text-xs"
    >
      Ton compte a des droits étendus. Active la vérification en deux étapes pour le sécuriser →
    </a>
  );
}
