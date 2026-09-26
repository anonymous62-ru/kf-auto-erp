import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listUsers } from '@/lib/users/actions';
import { UserList } from '@/components/users/user-list';

export default async function UsersPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect('/login');

  let users;
  try {
    users = await listUsers();
  } catch {
    // pas administrateur/super_admin : accès refusé, on renvoie au dashboard
    redirect('/dashboard');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Utilisateurs</h1>
        <Link href="/users/new" className="text-sm bg-kf-navy text-white rounded-md px-3 py-1.5">
          + Nouveau
        </Link>
      </div>
      <UserList users={users} currentUserId={userData.user.id} />
    </div>
  );
}
