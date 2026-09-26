import { MfaChallengeForm } from '@/components/auth/mfa-challenge-form';

export default function MfaChallengePage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-xl border p-6 space-y-4">
        <h1 className="text-lg font-medium text-kf-navy">Vérification en deux étapes</h1>
        <MfaChallengeForm />
      </div>
    </main>
  );
}
