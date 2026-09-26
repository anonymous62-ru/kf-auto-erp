// Authentification à deux facteurs (TOTP) via Supabase Auth MFA — aucune
// table ni migration nécessaire, tout est géré par Supabase (auth.mfa_*).
// Utilisé uniquement côté navigateur (l'inscription/vérification est un
// flux interactif : scan du QR code puis saisie d'un code à 6 chiffres).
import { createClient } from '@/lib/supabase/client';

export async function listTotpFactors() {
  const supabase = createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw new Error(error.message);
  return data.totp;
}

export async function enrollTotp() {
  const supabase = createClient();
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
  if (error) throw new Error(error.message);
  // Le type renvoyé par le SDK est une union (totp | phone) car enroll() est
  // générique sur tous les types de facteurs ; on force ici le type puisque
  // factorType: 'totp' garantit que la réponse contient bien `totp`, ce que
  // le typage du SDK ne reflète pas automatiquement (npm run dev ne fait pas
  // de vérification de type complète, contrairement à "next build" utilisé
  // par Vercel — c'est pour ça que ce n'était jamais apparu avant).
  return data as { id: string; type: 'totp'; totp: { qr_code: string; secret: string; uri: string } };
}

export async function verifyTotpEnrollment(factorId: string, code: string) {
  const supabase = createClient();
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError) throw new Error(challengeError.message);

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
  if (verifyError) throw new Error(verifyError.message);
}

export async function unenrollTotp(factorId: string) {
  const supabase = createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw new Error(error.message);
}

// Vérifie/complète le défi 2FA lors d'une connexion (session au niveau
// aal1 alors qu'un facteur vérifié existe → aal2 requis).
export async function challengeAndVerifyLogin(factorId: string, code: string) {
  const supabase = createClient();
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError) throw new Error(challengeError.message);

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
  if (verifyError) throw new Error(verifyError.message);
}

export async function getAssuranceLevel() {
  const supabase = createClient();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw new Error(error.message);
  return data; // { currentLevel, nextLevel, currentAuthenticationMethods }
}
