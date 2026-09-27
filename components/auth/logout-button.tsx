'use client';

import { useTransition } from 'react';
import { signOut } from '@/lib/auth/actions';

export function LogoutButton() {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        await signOut();
      } catch (e) {
        // redirect() lève une exception spéciale côté Next.js pour effectuer
        // la redirection : ce n'est pas une vraie erreur, il ne faut rien
        // afficher ni bloquer le clic dans ce cas.
        if (e instanceof Error && e.message === 'NEXT_REDIRECT') return;
      }
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      title="Se déconnecter"
      className="text-xs opacity-80 hover:opacity-100 border border-white/30 rounded-md px-2 py-1 transition-colors hover:bg-white/10 disabled:opacity-40"
    >
      {isPending ? '...' : 'Déconnexion'}
    </button>
  );
}
