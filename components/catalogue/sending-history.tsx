import type { CatalogueSendingRow } from '@/lib/catalogue/actions';
import { CATALOGUE_CHANNELS } from '@/lib/catalogue/roles';

function when(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Lome',
  });
}

// Historique des catalogues envoyés (fiche lead / client).
export function CatalogueSendingHistory({ rows, showRecipient = false }: { rows: CatalogueSendingRow[]; showRecipient?: boolean }) {
  return (
    <section className="card p-4">
      <p className="text-sm font-semibold text-gray-900">Catalogues envoyés</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">Aucun catalogue envoyé pour l&apos;instant.</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100">
          {rows.map((r) => {
            const expired = new Date(r.expires_at).getTime() < Date.now();
            return (
              <li key={r.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm text-gray-900">{r.models.join(', ')}</p>
                  <p className="text-xs text-gray-500">
                    {when(r.created_at)} · {CATALOGUE_CHANNELS[r.channel] ?? r.channel}
                    {r.sender ? ` · par ${r.sender}` : ''}
                    {showRecipient && (r.recipient_name || r.recipient_phone || r.recipient_email)
                      ? ` · à ${r.recipient_name || r.recipient_phone || r.recipient_email}`
                      : ''}
                    {r.show_prices ? ' · avec prix' : ''}
                  </p>
                </div>
                <div className="shrink-0 text-xs">
                  {r.opened_count > 0 ? (
                    <span className="inline-flex items-center rounded-sm bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                      Ouvert {r.opened_count} fois{r.last_opened_at ? `, dernier le ${when(r.last_opened_at)}` : ''}
                    </span>
                  ) : expired ? (
                    <span className="inline-flex items-center rounded-sm bg-gray-100 px-2 py-0.5 font-medium text-gray-600">Lien expiré</span>
                  ) : (
                    <span className="inline-flex items-center rounded-sm bg-amber-50 px-2 py-0.5 font-medium text-amber-700">Pas encore ouvert</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
