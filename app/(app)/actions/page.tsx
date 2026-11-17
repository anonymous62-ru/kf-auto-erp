import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMe, listActionItems, type ActionItemRow } from '@/lib/notifications/server';
import { actionKindLabel, documentTypeLabel, formatAge, formatFcfa, safeInternalPath } from '@/lib/notifications/labels';

export const dynamic = 'force-dynamic';

const DIRECTION = ['super_admin', 'administrateur', 'manager'];

function str(v: unknown) {
  return v === null || v === undefined ? '' : String(v);
}

function AgeBadge({ createdAt }: { createdAt: string }) {
  const hours = (Date.now() - new Date(createdAt).getTime()) / 3600000;
  const cls = hours >= 48 ? 'badge-red' : hours >= 24 ? 'badge-amber' : 'badge-gray';
  const hint = hours >= 48 ? 'Plus de 48 h : direction en copie' : hours >= 24 ? 'Plus de 24 h : rappel envoyé' : undefined;
  return (
    <span className={`badge ${cls} num whitespace-nowrap`} title={hint}>
      {formatAge(createdAt)}
    </span>
  );
}

function Row({ a, showAssignee, done }: { a: ActionItemRow; showAssignee: boolean; done: boolean }) {
  const p = a.payload;
  const doc = [documentTypeLabel(str(p.document_type)), str(p.document_number)].filter(Boolean).join(' ');
  const amount = formatFcfa(p.amount);
  const requester = a.requester?.full_name || str(p.requester);
  const href = safeInternalPath(a.link ?? (a.document_id ? `/documents/${a.document_id}` : null), '/actions');
  return (
    <tr>
      <td>
        <span className="block font-medium text-gray-900">{actionKindLabel(a.kind)}</span>
        <span className="block text-xs text-gray-500">{a.title}</span>
      </td>
      <td className="whitespace-nowrap">{doc || '-'}</td>
      <td>{str(p.client) || '-'}</td>
      <td className="num whitespace-nowrap text-right">{amount ?? '-'}</td>
      <td>{requester || '-'}</td>
      {showAssignee && <td>{a.assignee?.full_name ?? '-'}</td>}
      <td>
        {done ? (
          <span className="text-xs text-gray-500">
            {a.status === 'annulee' ? 'Annulée' : 'Traitée'}
            {a.done_at ? ` le ${new Date(a.done_at).toLocaleDateString('fr-FR', { timeZone: 'Africa/Lome' })}` : ''}
            {a.doneBy?.full_name ? ` par ${a.doneBy.full_name}` : ''}
          </span>
        ) : (
          <AgeBadge createdAt={a.created_at} />
        )}
      </td>
      <td className="text-right">
        <Link href={href} className="btn-secondary btn-sm">
          Ouvrir
        </Link>
      </td>
    </tr>
  );
}

export default async function ActionsPage({
  searchParams,
}: {
  searchParams: Promise<{ onglet?: string; vue?: string }>;
}) {
  const me = await getMe();
  if (!me) redirect('/login');
  const sp = await searchParams;
  const isDirection = DIRECTION.includes(me.profile.role);
  const team = isDirection && sp.vue === 'equipe';
  const done = sp.onglet === 'traitees';

  const [items, openMine] = await Promise.all([
    listActionItems({ team, done, userId: me.profile.id }),
    done || team ? listActionItems({ team: false, done: false, userId: me.profile.id }) : Promise.resolve(null),
  ]);
  const openCount = (done || team ? openMine : items)?.length ?? 0;
  const late24 = !done ? items.filter((a) => Date.now() - new Date(a.created_at).getTime() >= 24 * 3600000).length : 0;

  const href = (o: { onglet?: string; vue?: string }) => {
    const q = new URLSearchParams();
    if (o.onglet) q.set('onglet', o.onglet);
    if (o.vue) q.set('vue', o.vue);
    const s = q.toString();
    return s ? `/actions?${s}` : '/actions';
  };
  const vue = team ? 'equipe' : undefined;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Mes actions en attente</h1>
        <p className="page-subtitle">
          Validations et vérifications qui vous attendent. Un rappel part après 24 h ; après 48 h, la direction est mise en copie.
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <nav className="tabs" aria-label="Sections">
          <Link href={href({ vue })} aria-current={!done ? 'page' : undefined} className={`tab ${!done ? 'tab-active' : ''}`}>
            En attente
            {!team && <span className="num ml-1.5 text-xs text-gray-400">{openCount}</span>}
          </Link>
          <Link
            href={href({ onglet: 'traitees', vue })}
            aria-current={done ? 'page' : undefined}
            className={`tab ${done ? 'tab-active' : ''}`}
          >
            Traitées récemment
          </Link>
        </nav>
        {isDirection && (
          <div className="flex gap-1.5" role="group" aria-label="Périmètre">
            <Link href={href({ onglet: done ? 'traitees' : undefined })} className={`chip ${!team ? 'chip-active' : ''}`}>
              Les miennes
            </Link>
            <Link
              href={href({ onglet: done ? 'traitees' : undefined, vue: 'equipe' })}
              className={`chip ${team ? 'chip-active' : ''}`}
            >
              Toute l&apos;équipe
            </Link>
          </div>
        )}
      </div>

      {!done && late24 > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {late24} action{late24 > 1 ? 's' : ''} en attente depuis plus de 24 h.
        </p>
      )}

      {items.length === 0 ? (
        <div className="card px-4 py-10 text-center text-sm text-gray-500">
          {done ? 'Aucune action traitée ces 14 derniers jours.' : 'Aucune action en attente. Tout est à jour.'}
        </div>
      ) : (
        <div className="table-wrap card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Document</th>
                <th>Client</th>
                <th className="text-right">Montant</th>
                <th>Demandeur</th>
                {team && <th>Destinataire</th>}
                <th>{done ? 'Statut' : 'En attente depuis'}</th>
                <th className="sr-only">Ouvrir</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <Row key={a.id} a={a} showAssignee={team} done={done} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {done && <p className="text-xs text-gray-400">Actions closes au cours des 14 derniers jours.</p>}
    </div>
  );
}
