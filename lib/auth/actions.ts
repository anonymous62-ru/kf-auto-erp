'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

// Déconnexion — nécessaire pour que l'utilisateur puisse changer de compte
// (plusieurs comptes avec des accès différents sur le même appareil).
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
