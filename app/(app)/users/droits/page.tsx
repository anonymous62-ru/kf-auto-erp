import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PermissionMatrix, type MatrixCell } from '@/components/users/permission-matrix';

// Droits des rôles (demande du 17/11/2026) : le super admin ajoute ou retire
// des droits d'action à chaque rôle. Réservé au super admin.
export default async function RolePermissionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (me?.role !== 'super_admin') redirect('/dashboard');

  const [{ data: matrix, error }, { data: defaults }] = await Promise.all([
    supabase.rpc('permission_matrix'),
    supabase.rpc('permission_defaults'),
  ]);

  const defaultMap = new Map<string, boolean>();
  for (const d of (defaults ?? []) as { role: string; permission: string; default_allowed: boolean }[]) {
    defaultMap.set(`${d.role}:${d.permission}`, d.default_allowed);
  }
  const cells: MatrixCell[] = ((matrix ?? []) as { role: string; permission: string; allowed: boolean }[]).map((r) => ({
    role: r.role,
    permission: r.permission,
    allowed: r.allowed,
    defaultAllowed: defaultMap.get(`${r.role}:${r.permission}`) ?? r.allowed,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="page-title">Droits des rôles</h1>
        <Link href="/users" className="btn-secondary">
          Utilisateurs
        </Link>
      </div>
      <div className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-md p-3 space-y-1">
        <p>
          Cochez ou décochez un droit pour l&apos;accorder ou le retirer à tout un rôle. Chaque case est enregistrée
          immédiatement et le changement est inscrit au journal d&apos;audit.
        </p>
        <p>
          Cette grille règle les <strong>actions</strong> (valider, vérifier, émettre, confirmer...). Ce que chacun
          peut <strong>voir</strong> (quels clients, quels documents) reste lié à son rôle : par exemple, un commercial
          qui reçoit « Valider les proformas » ne valide que les proformas qu&apos;il peut déjà consulter.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{error.message}</p>
      ) : (
        <PermissionMatrix cells={cells} />
      )}
    </div>
  );
}
