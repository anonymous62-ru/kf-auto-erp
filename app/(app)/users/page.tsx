import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listUsers } from '@/lib/users/actions';
import { UserList } from '@/components/users/user-list';

export default async function UsersPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect('/login');

  const { data: me } = await supabase.from('profiles').select('role').eq('id', userData.user.id).maybeSingle();
  const myRole = (me?.role as string | undefined) ?? null;

  let users;
  try {
    users = await listUsers();
  } catch {
    // sans le droit gerer_utilisateurs : accès refusé, on renvoie au dashboard
    redirect('/dashboard');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Utilisateurs</h1>
        <div className="flex items-center gap-2">
          {myRole === 'super_admin' && (
            <Link href="/users/droits" className="btn-secondary">
              Droits des rôles
            </Link>
          )}
          <Link href="/users/new" className="btn-primary">
            Nouveau
          </Link>
        </div>
      </div>
      <UserList users={users} currentUserId={userData.user.id} currentUserRole={myRole} />
    </div>
  );
}
