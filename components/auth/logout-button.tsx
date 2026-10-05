'use client';

import { useTransition } from 'react';
import { signOut } from '@/lib/auth/actions';
import { IconLogout } from '@/components/icons';

// Bouton de déconnexion, affiché en bas de la barre latérale (fond sombre).
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
      aria-label="Se déconnecter"
      className="shrink-0 rounded-md p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
    >
      <IconLogout className="w-[18px] h-[18px]" />
    </button>
  );
}
