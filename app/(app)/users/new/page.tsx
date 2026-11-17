import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { UserForm } from '@/components/users/user-form';
import { hasPermission } from '@/lib/permissions';

export default async function NewUserPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle();

  // Droit gerer_utilisateurs de la matrice des droits (migration 0058).
  if (!profile || !(await hasPermission('gerer_utilisateurs'))) {
    redirect('/dashboard');
  }

  return (
    <div className="space-y-4">
      <h1 className="page-title">Nouvel utilisateur</h1>
      <UserForm canCreateAdmins={profile.role === 'super_admin'} />
    </div>
  );
}
