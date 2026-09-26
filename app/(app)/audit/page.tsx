import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAuditLog } from '@/lib/audit/actions';
import { tableLabel, actionLabel } from '@/lib/audit/labels';

const ACTION_COLOR: Record<string, string> = {
  insert: 'text-green-600',
  update: 'text-amber-600',
  delete: 'text-red-600',
  login: 'text-gray-500',
};

const RECORD_LINK: Record<string, (id: string) => string> = {
  documents: (id) => `/documents/${id}`,
  clients: (id) => `/clients/${id}`,
};

export default async function AuditPage() {
  const supabase = await createClient();
  // Même correctif que le tableau de bord : filtrer par son propre id, sinon
  // un admin (qui peut voir tous les profils de son organisation via RLS)
  // reçoit plusieurs lignes et .single() plante silencieusement, ce qui le
  // renvoyait à tort vers /dashboard.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user?.id ?? '')
    .single();

  if (!profile || !['super_admin', 'administrateur'].includes(profile.role)) {
    redirect('/dashboard');
  }

  const entries = await getAuditLog();

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-medium">Journal d'audit</h1>
      <p className="text-xs text-gray-500">
        Historique des créations, modifications et suppressions sur les documents, clients et paiements de
        l'organisation : les 100 dernières actions.
      </p>

      {entries.length === 0 && (
        <p className="text-sm text-gray-500">
          Aucune entrée pour le moment (ou la migration 0005_audit_log_rls.sql n'a pas encore été exécutée).
        </p>
      )}

      <div className="space-y-2">
        {entries.map((entry) => {
          const author = Array.isArray(entry.profiles) ? entry.profiles[0] : entry.profiles;
          const link = entry.record_id ? RECORD_LINK[entry.table_name]?.(entry.record_id) : undefined;
          const date = new Date(entry.created_at);
          const content = (
            <div className="bg-white rounded-lg border p-3 text-sm">
              <div className="flex justify-between items-start">
                <p className="font-medium">
                  {tableLabel(entry.table_name)} ·{' '}
                  <span className={ACTION_COLOR[entry.action] ?? ''}>{actionLabel(entry.action)}</span>
                </p>
                <p className="text-[10px] text-gray-400 whitespace-nowrap">
                  {date.toLocaleDateString('fr-FR')} {date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <p className="text-xs text-gray-500">{author?.full_name ?? 'Système'}</p>
            </div>
          );
          return link ? (
            <a key={entry.id} href={link} className="block">
              {content}
            </a>
          ) : (
            <div key={entry.id}>{content}</div>
          );
        })}
      </div>
    </div>
  );
}
