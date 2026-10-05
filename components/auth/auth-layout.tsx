// Habillage commun des écrans d'authentification (connexion, double
// authentification) : panneau de marque à gauche sur ordinateur, bandeau
// compact en haut sur téléphone, formulaire à droite.
import { OrganizationBadge } from '@/components/organization-badge';
import { IconDocument, IconCar, IconWrench } from '@/components/icons';

const FEATURES = [
  {
    icon: IconDocument,
    title: 'Devis, proformas et factures',
    text: 'Au modèle KF Auto, avec numérotation, signature et suivi des paiements.',
  },
  {
    icon: IconCar,
    title: 'Stock véhicules et pièces détachées',
    text: 'Quantités, seuils d\'alerte et historique des mouvements.',
  },
  {
    icon: IconWrench,
    title: 'Atelier, SAV et garanties',
    text: 'Ordres de réparation, rendez-vous et garanties constructeur.',
  },
];

export function AuthLayout({
  branding,
  children,
}: {
  branding: { name?: string | null; logoUrl?: string | null };
  children: React.ReactNode;
}) {
  const name = branding.name || 'KF Auto SARL';

  return (
    <div className="min-h-screen bg-white lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Panneau de marque (ordinateur) */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-kf-navy-950 text-white px-12 py-10">
        <BackgroundPattern />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white p-1.5">
            <OrganizationBadge logoUrl={branding.logoUrl} name={name} className="h-full w-full rounded-md text-kf-navy text-sm" />
          </span>
          <span>
            <span className="block text-base font-semibold tracking-tight">{name}</span>
            <span className="block text-xs text-white/50">Chery Togo · Lomé</span>
          </span>
        </div>

        <div className="relative max-w-md">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-kf-orange">KF Auto ERP</p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight">
            Gestion commerciale et après‑vente
          </h2>
          <ul className="mt-8 space-y-5">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
                  <Icon className="w-[18px] h-[18px] text-white/80" />
                </span>
                <span>
                  <span className="block text-sm font-medium">{title}</span>
                  <span className="block mt-0.5 text-sm text-white/55 leading-relaxed">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative space-y-4">
          <div className="brand-stripe w-28 rounded-sm">
            <span />
            <span />
            <span />
            <span />
          </div>
          <p className="text-xs text-white/40">© {new Date().getFullYear()} {name}. Usage interne réservé au personnel.</p>
        </div>
      </aside>

      {/* Bandeau (téléphone / tablette) */}
      <div className="lg:hidden bg-kf-navy-950 text-white">
        <div className="brand-stripe">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="flex items-center gap-3 px-6 py-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white p-1.5">
            <OrganizationBadge logoUrl={branding.logoUrl} name={name} className="h-full w-full rounded-md text-kf-navy text-xs" />
          </span>
          <span>
            <span className="block text-sm font-semibold">{name}</span>
            <span className="block text-xs text-white/50">KF Auto ERP · Chery Togo</span>
          </span>
        </div>
      </div>

      {/* Formulaire */}
      <main className="flex min-h-[calc(100vh-84px)] items-start justify-center px-6 py-10 sm:items-center lg:min-h-screen">
        <div className="w-full max-w-[380px]">{children}</div>
      </main>
    </div>
  );
}

// Motif de lignes très discret (rappel de la calandre / des lignes de route),
// sans dégradé ni effet animé.
function BackgroundPattern() {
  return (
    <svg aria-hidden className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
      <defs>
        <pattern id="kf-lines" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
          <line x1="0" y1="0" x2="0" y2="28" stroke="white" strokeOpacity="0.035" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#kf-lines)" />
    </svg>
  );
}
