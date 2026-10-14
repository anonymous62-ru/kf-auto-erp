import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentProfile } from '@/lib/permissions';
import { listUserRequests } from '@/lib/users/requests';
import { DIRECTION_ROLES, managedDepartment, roleLabel, departmentLabel } from '@/lib/users/roles';
import { RequestActions } from '@/components/users/request-actions';
import { IconPlus } from '@/components/icons';

const STATUS: Record<string, { label: string; badge: string }> = {
  en_attente: { label: 'En attente', badge: 'badge-orange' },
  validee: { label: 'Validée', badge: 'badge-green' },
  refusee: { label: 'Refusée', badge: 'badge-gray' },
};

export default async function UserRequestsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  const isDirection = DIRECTION_ROLES.includes(profile.role);
  const myDepartment = managedDepartment(profile.role, profile.department);
  if (!isDirection && !myDepartment) redirect('/dashboard');

  const requests = await listUserRequests();
  const pending = requests.filter((r) => r.status === 'en_attente');
  const done = requests.filter((r) => r.status !== 'en_attente');

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Demandes d&apos;inscription</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {isDirection
              ? 'Les chefs de service demandent les comptes de leurs agents ; vous les validez.'
              : `Demandez un compte pour un agent du département ${departmentLabel(myDepartment)}.`}
          </p>
        </div>
        <Link href="/users/demandes/new" className="btn-primary">
          <IconPlus className="w-4 h-4" /> Nouvelle demande
        </Link>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">En attente ({pending.length})</h2>
        {pending.length === 0 && <p className="card px-4 py-6 text-center text-sm text-gray-500">Aucune demande en attente.</p>}
        {pending.map((r) => (
          <div key={r.id} className="card p-4 space-y-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-medium text-gray-900">{r.full_name}</p>
                <p className="text-sm text-gray-600">
                  {roleLabel(r.role)} · {departmentLabel(r.department)}
                </p>
                <p className="text-xs text-gray-500">
                  {r.email}
                  {r.phone ? ` · ${r.phone}` : ''}
                </p>
                {r.note && <p className="mt-1 text-xs text-gray-600">« {r.note} »</p>}
              </div>
              <p className="text-xs text-gray-500 sm:text-right">
                Demandé par {r.requester?.full_name ?? 'un chef de service'}
                <br />
                le {new Date(r.created_at).toLocaleDateString('fr-FR')}
              </p>
            </div>
            {isDirection ? (
              <RequestActions requestId={r.id} />
            ) : (
              <span className={STATUS.en_attente.badge}>En attente de la direction</span>
            )}
          </div>
        ))}
      </section>

      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">Traitées</h2>
          <div className="card divide-y divide-gray-100">
            {done.map((r) => {
              const st = STATUS[r.status] ?? STATUS.en_attente;
              return (
                <div key={r.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{r.full_name}</p>
                    <p className="text-xs text-gray-500">
                      {roleLabel(r.role)} · {departmentLabel(r.department)}
                      {r.decision_note ? ` · ${r.decision_note}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-right">
                    <span className={st.badge}>{st.label}</span>
                    {r.decided_at && (
                      <span className="block text-xs text-gray-400 mt-1">
                        {new Date(r.decided_at).toLocaleDateString('fr-FR')}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
