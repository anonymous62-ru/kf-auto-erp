import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getTeamOverview } from '@/lib/team/actions';
import { formatCFA } from '@/lib/documents/calculations';
import { IconChevronRight } from '@/components/icons';

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  administrateur: 'Administrateur',
  manager: 'Manager',
  comptable: 'Comptable',
  commercial: 'Commercial',
};

export default async function TeamActivityPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect('/login');

  let team;
  try {
    team = await getTeamOverview();
  } catch {
    redirect('/dashboard');
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-medium">Suivi des commerciaux</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Vue d'ensemble de l'activité de chaque membre de l'équipe : clients, prospects, documents et contrats.
        </p>
      </div>

      {team.length === 0 && <p className="text-sm text-gray-400">Aucun utilisateur pour l'instant.</p>}

      <div className="space-y-2">
        {team.map((m) => (
          <Link key={m.id} href={`/team/${m.id}`} className="card card-hover block p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{m.full_name || '(sans nom)'}</p>
                <p className="text-xs text-gray-500">
                  {ROLE_LABELS[m.role] ?? m.role}
                  {!m.is_active && <span className="text-red-500"> · désactivé</span>}
                </p>
              </div>
              <IconChevronRight className="w-4 h-4 text-gray-300" />
            </div>
            <div className="grid grid-cols-4 gap-2 mt-3 text-center">
              <div>
                <p className="text-sm font-semibold">{m.clients_count}</p>
                <p className="text-[10px] text-gray-400">Clients</p>
              </div>
              <div>
                <p className="text-sm font-semibold">{m.prospects_actifs_count}</p>
                <p className="text-[10px] text-gray-400">Prospects</p>
              </div>
              <div>
                <p className="text-sm font-semibold">{m.documents_count}</p>
                <p className="text-[10px] text-gray-400">Documents</p>
              </div>
              <div>
                <p className="text-sm font-semibold">{m.contracts_count}</p>
                <p className="text-[10px] text-gray-400">Contrats</p>
              </div>
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t text-xs">
              <span className="text-green-600">CA du mois : {formatCFA(m.revenue_month)}</span>
              {m.unpaid_total > 0 && <span className="text-kf-red">Impayés : {formatCFA(m.unpaid_total)}</span>}
            </div>
            {m.last_activity_at && (
              <p className="text-[10px] text-gray-400 mt-1">
                Dernière activité : {new Date(m.last_activity_at).toLocaleDateString('fr-FR')}
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
