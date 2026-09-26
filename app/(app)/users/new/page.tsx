import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { UserForm } from '@/components/users/user-form';

export default async function NewUserPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (!profile || !['super_admin', 'administrateur'].includes(profile.role)) {
    redirect('/dashboard');
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium">Nouvel utilisateur</h1>
      <UserForm canCreateAdmins={profile.role === 'super_admin'} />
    </div>
  );
}
