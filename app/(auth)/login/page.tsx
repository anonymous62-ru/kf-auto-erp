'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { OrganizationBadge } from '@/components/organization-badge';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      .then(({ data }: { data: { name: string; logo_url: string | null } | null }) => {
        if (data) setBranding(data);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError("Connexion impossible. Verifiez votre email et mot de passe.");
      return;
    }
    router.push('/dashboard');
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-kf-navy via-[#1f3159] to-[#0f1930]">
      <form onSubmit={handleSubmit} className="w-full max-w-sm card overflow-hidden">
        <div className="brand-stripe">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="p-7 space-y-5">
          <div className="text-center space-y-1">
            <OrganizationBadge
              logoUrl={branding?.logo_url}
              name={branding?.name || 'KF Auto SARL'}
              className="h-12 w-12 rounded-2xl bg-kf-navy text-white mb-1 mx-auto"
            />
            <h1 className="text-lg font-semibold text-kf-navy">KF Auto ERP</h1>
            <p className="text-xs text-gray-400">Chery Togo, gestion commerciale</p>
          </div>
          <div>
            <label className="field-label">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input mt-1"
              required
            />
          </div>
          <div>
            <label className="field-label">Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input mt-1"
              required
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>
        </div>
      </form>
    </main>
  );
}
