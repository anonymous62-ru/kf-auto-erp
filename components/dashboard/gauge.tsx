// Compte-tours de l'objectif mensuel (maquette « cockpit ») : arc de 240°,
// progression en blanc, repère rouge à la position actuelle, graduation
// finale rouge. Seule animation de l'écran : le repère glisse jusqu'à sa
// place au chargement (désactivée si l'utilisateur limite les animations).

const CX = 150;
const CY = 138;
const R = 116;
const START = 150; // degrés, sens horaire (repère SVG, y vers le bas)
const SWEEP = 240;

function point(angleDeg: number, r: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: +(CX + r * Math.cos(a)).toFixed(1), y: +(CY + r * Math.sin(a)).toFixed(1) };
}

function arc(fraction: number) {
  const f = Math.max(0, Math.min(1, fraction));
  const s = point(START, R);
  const e = point(START + SWEEP * f, R);
  const large = SWEEP * f > 180 ? 1 : 0;
  return `M${s.x} ${s.y} A${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`;
}

export function millions(n: number) {
  const m = n / 1_000_000;
  const v = m >= 100 ? Math.round(m) : Math.round(m * 10) / 10;
  return String(v).replace('.', ',');
}

export function TargetGauge({
  invoiced,
  target,
  monthName,
}: {
  invoiced: number;
  target: number;
  monthName: string;
}) {
  const hasTarget = target > 0;
  const fraction = hasTarget ? invoiced / target : 0;
  const shown = Math.max(0, Math.min(1, fraction));
  const needleAngle = START + SWEEP * shown;
  const n1 = point(needleAngle, 102);
  const n2 = point(needleAngle, 130);
  const pct = hasTarget ? Math.round(fraction * 100) : null;
  const label = hasTarget
    ? `Objectif de ${monthName} : ${millions(invoiced)} millions facturés sur ${millions(target)}, soit ${pct} %`
    : `Facturé en ${monthName} : ${millions(invoiced)} millions, aucun objectif fixé`;

  return (
    <div className="relative h-[210px] w-[300px] shrink-0" role="img" aria-label={label}>
      <svg viewBox="0 0 300 210" className="h-[210px] w-[300px] overflow-visible" aria-hidden="true">
        <path d={arc(1)} fill="none" stroke="#1D3352" strokeWidth="14" strokeLinecap="round" />
        {shown > 0 && <path d={arc(shown)} fill="none" stroke="#FFFFFF" strokeWidth="14" strokeLinecap="round" />}
        <g>
          {Array.from({ length: 9 }, (_, i) => {
            const a = START + i * 30;
            const p1 = point(a, 128);
            const p2 = point(a, i % 2 === 0 ? 135 : 131);
            return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={i === 8 ? '#D7262E' : '#5E7090'} strokeWidth="2" />;
          })}
        </g>
        {hasTarget && (
          <g fontFamily="Inter, sans-serif" fontSize="11" fill="#8A9BB2" textAnchor="middle">
            <text x="22" y="216">0</text>
            <text x="150" y="-2">{millions(target / 2)} M</text>
            <text x="278" y="216" fill="#FF8D91">
              {millions(target)} M
            </text>
          </g>
        )}
        {hasTarget && (
          <g className="gauge-needle" style={{ ['--gauge-from' as string]: `${-SWEEP * shown}deg` }}>
            <line x1={n1.x} y1={n1.y} x2={n2.x} y2={n2.y} stroke="#D7262E" strokeWidth="5" strokeLinecap="round" />
          </g>
        )}
      </svg>
      <div className="absolute inset-x-0 top-[92px] text-center">
        <b className="num block font-display text-[46px] font-extrabold leading-none tracking-[-0.03em]">
          {millions(invoiced)}
          <small className="ml-[3px] text-[18px] font-semibold text-acier">M</small>
        </b>
        <span className="mt-1.5 block text-[12.5px] text-acier">
          {hasTarget ? `facturés sur ${millions(target)} M` : 'facturés ce mois'}
        </span>
      </div>
      <div className="absolute inset-x-0 -bottom-0.5 text-center text-[13px] text-[#C3CEDD]">
        {hasTarget ? `Objectif de ${monthName}` : 'Objectif non fixé'}
      </div>
    </div>
  );
}
