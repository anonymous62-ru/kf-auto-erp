// Lecture d'une fiche de réception / restitution (composant serveur, sans état).
import {
  ACCESSORIES,
  INSPECTION_KIND_LABELS,
  WARNING_LIGHTS,
  damageLabel,
  formatKm,
  fuelLabel,
  labelOf,
  zoneLabel,
  type InspectionRow,
} from '@/lib/atelier/inspection-config';

function fmtDateTime(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Lome' });
}

function FuelBar({ level }: { level: number | null }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex w-40 gap-0.5">
        {Array.from({ length: 9 }, (_, i) => (
          <span
            key={i}
            className={`h-3 flex-1 rounded-sm ${level !== null && i <= level ? (level <= 1 ? 'bg-rouge' : 'bg-nuit') : 'bg-trait-2'}`}
          />
        ))}
      </div>
      <span className="text-sm font-medium">{fuelLabel(level)}</span>
    </div>
  );
}

export function InspectionView({
  inspection,
  fileUrls,
}: {
  inspection: InspectionRow;
  fileUrls: Record<string, string>;
}) {
  const c = inspection.checklist;
  const lights = c.warning_lights ?? [];
  const acc = c.accessories ?? [];
  const missing = ACCESSORIES.filter((a) => a.key !== 'autre' && !acc.includes(a.key));
  const sig = inspection.client_signature_url ? fileUrls[inspection.client_signature_url] : null;

  return (
    <div className="card p-4 space-y-4 print:border-0 print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">{INSPECTION_KIND_LABELS[inspection.kind]}</h2>
        {inspection.client_signed_at ? (
          <span className="badge-green">Signée par le client</span>
        ) : (
          <span className="badge-amber">Brouillon, non signée</span>
        )}
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-encre-3">Réceptionnaire</dt>
          <dd className="font-medium">{inspection.receptionist_name || 'Non renseigné'}</dd>
        </div>
        <div>
          <dt className="text-xs text-encre-3">Date et heure</dt>
          <dd className="font-medium">{fmtDateTime(inspection.inspected_at)}</dd>
        </div>
        <div>
          <dt className="text-xs text-encre-3">Kilométrage</dt>
          <dd className="font-medium num">{formatKm(inspection.mileage)}</dd>
        </div>
        <div>
          <dt className="text-xs text-encre-3">Carburant</dt>
          <dd>
            <FuelBar level={inspection.fuel_level} />
          </dd>
        </div>
      </dl>

      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-encre">Carrosserie et rayures</h3>
        {(c.body_damages ?? []).length === 0 ? (
          <p className="text-sm text-encre-2">{c.body_ok ? 'Aucun dégât visible.' : 'Aucun dégât relevé.'}</p>
        ) : (
          <ul className="list-disc pl-5 text-sm space-y-0.5">
            {(c.body_damages ?? []).map((d, i) => (
              <li key={i}>
                <span className="font-medium">{zoneLabel(d.zone)}</span> : {damageLabel(d.type)}
                {d.comment ? `, ${d.comment}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-encre">Voyants allumés</h3>
        {lights.length === 0 ? (
          <p className="text-sm text-encre-2">Aucun voyant allumé.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {lights.map((l) => (
              <span key={l} className="badge-amber">
                {l === 'autre' && c.warning_lights_other ? `Autre : ${c.warning_lights_other}` : labelOf(WARNING_LIGHTS, l)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-encre">Accessoires</h3>
        <div className="flex flex-wrap gap-1.5">
          {acc.length === 0 && <span className="text-sm text-encre-2">Aucun accessoire coché.</span>}
          {acc.map((a) => (
            <span key={a} className="badge-navy">
              {a === 'autre' && c.accessories_other ? `Autre : ${c.accessories_other}` : labelOf(ACCESSORIES, a)}
            </span>
          ))}
        </div>
        {acc.length > 0 && missing.length > 0 && (
          <p className="text-xs text-encre-3">Absents : {missing.map((m) => m.label).join(', ')}.</p>
        )}
      </div>

      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-encre">Observations</h3>
        <p className="whitespace-pre-line text-sm text-encre-2">{inspection.observations || 'Aucune observation.'}</p>
      </div>

      {inspection.photos.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-encre">Photos ({inspection.photos.length})</h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {inspection.photos.map((p) =>
              fileUrls[p] ? (
                <a key={p} href={fileUrls[p]} target="_blank" rel="noopener noreferrer" className="block aspect-square overflow-hidden rounded-md border border-trait">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileUrls[p]} alt="Photo du véhicule" className="h-full w-full object-cover" />
                </a>
              ) : (
                <span key={p} className="flex aspect-square items-center justify-center rounded-md border border-trait text-xs text-encre-3">
                  Indisponible
                </span>
              )
            )}
          </div>
        </div>
      )}

      <div className="space-y-1 border-t border-trait pt-3">
        <h3 className="text-sm font-semibold text-encre">Signature du client</h3>
        {inspection.client_signed_at ? (
          <div className="space-y-1">
            {sig && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={sig} alt="Signature du client" className="h-24 w-auto rounded border border-trait bg-white" />
            )}
            <p className="text-sm">
              {inspection.client_signer_name}, le {fmtDateTime(inspection.client_signed_at)}
            </p>
          </div>
        ) : (
          <p className="text-sm text-encre-3">Pas encore signée.</p>
        )}
      </div>
    </div>
  );
}
