// Compte-tours de l'objectif mensuel en véhicules (maquette « cockpit ») : arc de 240°,
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

function units(n: number) {
  return `${n} véhicule${n > 1 ? 's' : ''}`;
}

// Objectif en nombre de véhicules (migration 0048) : réalisé = véhicules des
// factures émises du mois, objectif = somme des objectifs du mois.
export function TargetGauge({
  achieved,
  target,
  monthName,
  personal = false,
}: {
  achieved: number;
  target: number;
  monthName: string;
  personal?: boolean;
}) {
  const hasTarget = target > 0;
  const fraction = hasTarget ? achieved / target : 0;
  const shown = Math.max(0, Math.min(1, fraction));
  const needleAngle = START + SWEEP * shown;
  const n1 = point(needleAngle, 102);
  const n2 = point(needleAngle, 130);
  const pct = hasTarget ? Math.round(fraction * 100) : null;
  const label = hasTarget
    ? `${personal ? 'Votre objectif' : 'Objectif'} de ${monthName} : ${units(achieved)} facturés sur ${target}, soit ${pct} %`
    : `Facturé en ${monthName} : ${units(achieved)}, aucun objectif fixé`;
  // Graduations : une par véhicule jusqu'à 16, sinon 9 repères réguliers.
  const ticks = hasTarget && target <= 16 ? target : 8;
  const half = hasTarget && target % 2 === 0 ? String(target / 2) : null;

  return (
    <div className="relative h-[210px] w-[300px] shrink-0" role="img" aria-label={label}>
      <svg viewBox="0 0 300 210" className="h-[210px] w-[300px] overflow-visible" aria-hidden="true">
        <path d={arc(1)} fill="none" stroke="#1D3352" strokeWidth="14" strokeLinecap="round" />
        {shown > 0 && <path d={arc(shown)} fill="none" stroke="#FFFFFF" strokeWidth="14" strokeLinecap="round" />}
        <g>
          {Array.from({ length: ticks + 1 }, (_, i) => {
            const a = START + (i * SWEEP) / ticks;
            const p1 = point(a, 128);
            const major = i === 0 || i === ticks || i * 2 === ticks || (ticks === 8 && i % 2 === 0);
            const p2 = point(a, major ? 135 : 131);
            return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={i === ticks ? '#D7262E' : '#5E7090'} strokeWidth="2" />;
          })}
        </g>
        {hasTarget && (
          <g fontFamily="Inter, sans-serif" fontSize="11" fill="#8A9BB2" textAnchor="middle" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <text x="22" y="216">0</text>
            {half && (
              <text x="150" y="-2">
                {half}
              </text>
            )}
            <text x="278" y="216" fill="#FF8D91">
              {target}
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
        <b className="num block font-display text-[46px] font-extrabold leading-none tracking-[-0.03em]">{achieved}</b>
        <span className="num mt-1.5 block text-[12.5px] text-acier">
          {hasTarget
            ? `véhicule${achieved > 1 ? 's' : ''} sur ${target}${pct !== null ? `, ${pct} %` : ''}`
            : `véhicule${achieved > 1 ? 's' : ''} facturé${achieved > 1 ? 's' : ''} ce mois`}
        </span>
      </div>
      <div className="absolute inset-x-0 -bottom-0.5 text-center text-[13px] text-[#C3CEDD]">
        {hasTarget ? `${personal ? 'Votre objectif' : 'Objectif'} de ${monthName}` : 'Objectif non fixé'}
      </div>
    </div>
  );
}
