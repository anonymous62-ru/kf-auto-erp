// Badge d'organisation : affiche le vrai logo (organizations.logo_url) une
// fois configuré via /settings/organisation, avec repli sur les initiales du
// nom de l'organisation tant qu'aucun logo n'est en place — jamais un texte
// "KF" codé en dur, qui n'a de sens que pour cette organisation précise.
export function OrganizationBadge({
  logoUrl,
  name,
  className = 'h-9 w-9 rounded-xl',
  imgClassName = '',
}: {
  logoUrl?: string | null;
  name?: string | null;
  className?: string;
  imgClassName?: string;
}) {
  const initials = (name || 'KF')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={name || 'Logo'}
        className={`${className} object-contain ${imgClassName}`}
      />
    );
  }

  return (
    <span className={`inline-flex items-center justify-center font-bold text-sm ${className}`}>
      {initials}
    </span>
  );
}
