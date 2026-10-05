import { MfaChallengeForm } from '@/components/auth/mfa-challenge-form';
import { AuthLayout } from '@/components/auth/auth-layout';
import { createClient } from '@/lib/supabase/server';

export default async function MfaChallengePage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc('get_organization_branding').maybeSingle();
  const branding = (data as { name: string; logo_url: string | null } | null) ?? null;

  return (
    <AuthLayout branding={{ name: branding?.name, logoUrl: branding?.logo_url }}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Vérification en deux étapes</h1>
        <p className="mt-1.5 text-sm text-gray-500">
          Saisissez le code à 6 chiffres affiché dans votre application d&apos;authentification.
        </p>
      </div>
      <div className="mt-8">
        <MfaChallengeForm />
      </div>
    </AuthLayout>
  );
}
