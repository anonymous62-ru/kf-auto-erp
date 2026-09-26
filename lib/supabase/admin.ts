// Client Supabase "admin" — utilise la cle SERVICE_ROLE, qui contourne les RLS.
// STRICTEMENT reserve aux Server Actions (jamais importe cote navigateur).
// Necessaire pour creer un compte utilisateur (Supabase Auth) depuis
// l'interface, sans passer par un e-mail de confirmation manuel.
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY manquant dans .env.local (recuperez-le dans Supabase > Project Settings > API > service_role) et ajoutez-le (jamais avec le prefixe NEXT_PUBLIC_, cette cle ne doit jamais atteindre le navigateur)."
    );
  }
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
