// Silhouettes de véhicules (maquette « cockpit ») : SUV ou pick-up, teintées
// selon la couleur du véhicule. Les vitres prennent une teinte claire sur une
// carrosserie foncée, foncée sur une carrosserie claire.

function isLight(hex: string) {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}

export function CarSilhouette({ body, color, title }: { body: 'suv' | 'pickup'; color: string; title?: string }) {
  const light = isLight(color);
  const glass = light ? '#5E7090' : '#C9D3E0';
  const outline = light ? '#C9D3E0' : 'none';
  return (
    <svg viewBox="0 0 160 56" className="h-14 w-full" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {body === 'pickup' ? (
        <>
          <path
            d="M6 44 L8 32 Q9 27 16 26 L40 25 L52 13 Q55 11 60 11 L86 11 Q90 11 92 14 L96 25 L152 25 Q155 25 155 29 L155 44 Z"
            fill={color}
            stroke={outline}
            strokeWidth="1"
          />
          <path d="M56 15 L68 15 L68 25 L46 25 Z M72 15 L86 15 Q88 15 89 17 L92 25 L72 25 Z" fill={glass} />
          <circle cx="34" cy="45" r="9" fill="#0D1B2E" stroke="#F5F6F8" strokeWidth="3" />
          <circle cx="128" cy="45" r="9" fill="#0D1B2E" stroke="#F5F6F8" strokeWidth="3" />
        </>
      ) : (
        <>
          <path
            d="M10 44 L12 33 Q14 27 22 26 L46 24 L60 13 Q63 11 68 11 L108 11 Q114 11 118 15 L130 25 L146 28 Q152 30 152 36 L152 44 Z"
            fill={color}
            stroke={outline}
            strokeWidth="1"
          />
          <path d="M64 15 L78 15 L78 24 L52 24 Z M82 15 L106 15 Q110 15 113 18 L119 24 L82 24 Z" fill={glass} />
          <circle cx="40" cy="45" r="9" fill="#0D1B2E" stroke="#F5F6F8" strokeWidth="3" />
          <circle cx="122" cy="45" r="9" fill="#0D1B2E" stroke="#F5F6F8" strokeWidth="3" />
        </>
      )}
    </svg>
  );
}
