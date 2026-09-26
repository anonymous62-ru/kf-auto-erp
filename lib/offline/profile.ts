// Recupere le profil courant (organization_id, user id) en le mettant en
// cache local, pour pouvoir creer client/document hors-ligne sans requete.
import { createClient } from '@/lib/supabase/client';
import { db, type CachedProfile } from '@/lib/offline/db';

export async function getCachedProfile(): Promise<CachedProfile | null> {
  const cached = await db.meta.get('profile');
  if (cached) return cached;
  return refreshCachedProfile();
}

export async function refreshCachedProfile(): Promise<CachedProfile | null> {
  if (!navigator.onLine) return (await db.meta.get('profile')) ?? null;

  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, full_name')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (!profile) return null;

  const record: CachedProfile = {
    key: 'profile',
    userId: userData.user.id,
    organizationId: profile.organization_id,
    fullName: profile.full_name ?? '',
  };
  await db.meta.put(record);
  return record;
}
