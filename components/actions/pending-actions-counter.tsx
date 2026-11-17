// Compteur des actions en attente de l'utilisateur (composant serveur),
// affiché sur le tableau de bord.
import Link from 'next/link';
import { countMyPendingActions } from '@/lib/notifications/server';

export async function PendingActionsCounter() {
  const count = await countMyPendingActions();
  const pending = count > 0;
  return (
    <Link
      href="/actions"
      className={`card flex items-center gap-3.5 px-4 py-3 hover:bg-[#FAFBFC] ${pending ? 'border-l-[3px] border-l-rouge' : ''}`}
      aria-label={`Mes actions en attente : ${count}`}
    >
      <span className={`num w-[46px] shrink-0 text-right font-display text-[22px] font-bold tracking-[-0.02em] ${pending ? 'text-rouge' : 'text-encre-3'}`}>
        {count}
      </span>
      <span className="min-w-0">
        <b className="block font-medium">Mes actions en attente</b>
        <span className="block truncate text-[12.5px] text-encre-3">
          {pending
            ? `${count > 1 ? 'Validations ou vérifications' : 'Une validation ou vérification'} à traiter`
            : 'Aucune validation ne vous attend.'}
        </span>
      </span>
      <svg viewBox="0 0 24 24" className="ml-auto h-4 w-4 shrink-0" fill="none" stroke="#B6BECA" strokeWidth="2" aria-hidden="true">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </Link>
  );
}
