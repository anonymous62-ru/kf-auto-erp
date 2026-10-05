'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { AuthLayout } from '@/components/auth/auth-layout';
import { IconMail, IconLock, IconEye, IconEyeOff, IconAlert } from '@/components/icons';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [branding, setBranding] = useState<{ name: string; logo_url: string | null } | null>(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    // Fonction publique (security definer, voir migration 0008) : expose
    // uniquement nom + logo, pas le reste des données de l'organisation, pour
    // pouvoir afficher le vrai logo dès l'écran de connexion (avant
    // authentification).
    supabase
      .rpc('get_organization_branding')
      .single()
      .then((res) => {
        const data = res.data as { name: string; logo_url: string | null } | null;
        if (data) setBranding(data);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return; // garde anti double-clic
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setLoading(false);
      setError('Connexion impossible. Vérifiez votre adresse email et votre mot de passe.');
      return;
    }
    // On laisse le bouton en état "connexion" pendant la redirection.
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <AuthLayout branding={{ name: branding?.name, logoUrl: branding?.logo_url }}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Connexion</h1>
        <p className="mt-1.5 text-sm text-gray-500">Accédez à votre espace avec vos identifiants professionnels.</p>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate={false}>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            Adresse email
          </label>
          <div className="relative mt-1.5">
            <IconMail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="votre.email@exemple.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input h-11 pl-9"
              required
            />
          </div>
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">
            Mot de passe
          </label>
          <div className="relative mt-1.5">
            <IconLock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input h-11 pl-9 pr-10"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              {showPassword ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && (
          <div role="alert" className="flex gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" disabled={loading} className="btn-primary h-11 w-full">
          {loading ? 'Connexion en cours...' : 'Se connecter'}
        </button>
      </form>

      <p className="mt-8 border-t border-gray-100 pt-5 text-xs leading-relaxed text-gray-500">
        Mot de passe oublié ou compte bloqué ? Contactez l&apos;administrateur de la plateforme, qui peut réinitialiser
        votre accès depuis la gestion des utilisateurs.
      </p>
    </AuthLayout>
  );
}
