import { getParts } from '@/lib/pieces/actions';
import { formatCFA } from '@/lib/documents/calculations';
import Link from 'next/link';
import { IconPlus, IconAlert } from '@/components/icons';
import { can, getCurrentRole } from '@/lib/permissions';

export default async function PiecesPage() {
  const role = await getCurrentRole();
  const parts = await getParts();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Magasin de pièces</h1>
        {can(role, 'partWrite') && (
          <Link href="/pieces/new" className="btn-primary text-sm px-3 py-1.5">
            <IconPlus className="w-3.5 h-3.5" /> Nouvelle pièce
          </Link>
        )}
      </div>

      {parts.length === 0 && (
        <div className="card p-4 text-sm text-gray-500">
          Aucune pièce enregistrée pour le moment. Ajoutez vos premières références (filtres, plaquettes, huiles…).
        </div>
      )}

      <div className="space-y-2">
        {parts.map((p) => {
          const qty = Number(p.quantity_on_hand);
          const reserved = Number(p.quantity_reserved);
          const available = qty - reserved;
          const min = Number(p.stock_min);
          const low = available <= min;
          const subtitle = [p.reference, p.brand].filter(Boolean).join(' · ');
          return (
            <Link key={p.id} href={`/pieces/${p.id}`} className="card card-hover p-3 text-sm flex justify-between items-center gap-3">
              <div className="min-w-0">
                <p className="font-medium truncate">
                  {p.designation}
                  {!p.is_active && <span className="badge badge-gray ml-2 align-middle">En attente d&apos;activation</span>}
                </p>
                <p className="text-xs text-gray-500">{subtitle}</p>
                <p className={`text-xs mt-1 flex items-center gap-1 ${low ? 'text-kf-red font-medium' : 'text-gray-500'}`}>
                  {low && <IconAlert className="w-3 h-3" />}
                  Dispo : {available} {reserved > 0 && `(dont ${reserved} réservée${reserved > 1 ? 's' : ''})`}
                  {low && ' — seuil atteint'}
                </p>
              </div>
              <p className="font-medium whitespace-nowrap">{formatCFA(Number(p.sale_price))}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
