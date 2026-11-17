// Comparaison état d'entrée / état de sortie (composant serveur).
// Une dégradation (carburant en baisse, nouveau voyant, accessoire absent,
// nouveau dégât) est mise en évidence en rouge.
import {
  ACCESSORIES,
  WARNING_LIGHTS,
  compareInspections,
  damageLabel,
  formatKm,
  fuelLabel,
  labelOf,
  zoneLabel,
  type InspectionRow,
} from '@/lib/atelier/inspection-config';

function Row({
  label,
  entry,
  exit,
  bad,
  note,
}: {
  label: string;
  entry: React.ReactNode;
  exit: React.ReactNode;
  bad?: boolean;
  note?: React.ReactNode;
}) {
  return (
    <tr className={bad ? 'bg-rouge-clair' : undefined}>
      <th scope="row" className="px-3 py-2.5 text-left align-top text-xs font-medium text-encre-3 w-[30%]">
        {label}
      </th>
      <td className="px-3 py-2.5 align-top text-sm">{entry}</td>
      <td className={`px-3 py-2.5 align-top text-sm ${bad ? 'font-semibold text-rouge' : ''}`}>
        {exit}
        {note && <span className={`block text-xs ${bad ? 'text-rouge' : 'text-encre-3'}`}>{note}</span>}
      </td>
    </tr>
  );
}

export function InspectionComparison({ entry, exit }: { entry: InspectionRow; exit: InspectionRow }) {
  const cmp = compareInspections(entry, exit);
  const inC = entry.checklist;
  const outC = exit.checklist;

  const lightName = (k: string, other?: string) => (k === 'autre' && other ? `Autre (${other})` : labelOf(WARNING_LIGHTS, k));
  const accName = (k: string, other?: string) => (k === 'autre' && other ? `Autre (${other})` : labelOf(ACCESSORIES, k));

  return (
    <section className="card p-4 space-y-3 print:break-inside-avoid">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">Comparaison entrée / sortie</h2>
        {cmp.hasDegradation ? (
          <span className="badge-red">Écarts à signaler</span>
        ) : (
          <span className="badge-green">Aucune dégradation constatée</span>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border border-trait">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-trait bg-papier text-xs text-encre-3">
              <th className="px-3 py-2 text-left font-medium" />
              <th className="px-3 py-2 text-left font-medium">Entrée</th>
              <th className="px-3 py-2 text-left font-medium">Sortie</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-trait-2">
            <Row
              label="Kilométrage"
              entry={<span className="num">{formatKm(entry.mileage)}</span>}
              exit={<span className="num">{formatKm(exit.mileage)}</span>}
              note={cmp.distanceKm !== null ? `Parcourus pendant l'immobilisation : ${formatKm(cmp.distanceKm)}` : undefined}
            />
            <Row
              label="Carburant"
              entry={fuelLabel(cmp.fuelIn)}
              exit={fuelLabel(cmp.fuelOut)}
              bad={cmp.fuelDropped}
              note={cmp.fuelDropped ? 'Niveau plus bas qu’à l’entrée' : undefined}
            />
            <Row
              label="Voyants allumés"
              entry={(inC.warning_lights ?? []).length ? (inC.warning_lights ?? []).map((k) => lightName(k, inC.warning_lights_other)).join(', ') : 'Aucun'}
              exit={(outC.warning_lights ?? []).length ? (outC.warning_lights ?? []).map((k) => lightName(k, outC.warning_lights_other)).join(', ') : 'Aucun'}
              bad={cmp.newWarningLights.length > 0}
              note={
                cmp.newWarningLights.length > 0
                  ? `Nouveau : ${cmp.newWarningLights.map((k) => lightName(k, outC.warning_lights_other)).join(', ')}`
                  : cmp.clearedWarningLights.length > 0
                    ? `Éteint depuis l'entrée : ${cmp.clearedWarningLights.map((k) => lightName(k, inC.warning_lights_other)).join(', ')}`
                    : undefined
              }
            />
            <Row
              label="Accessoires"
              entry={`${(inC.accessories ?? []).length} présent(s)`}
              exit={`${(outC.accessories ?? []).length} présent(s)`}
              bad={cmp.missingAccessories.length > 0}
              note={
                cmp.missingAccessories.length > 0
                  ? `Manquant par rapport à l'entrée : ${cmp.missingAccessories.map((k) => accName(k, inC.accessories_other)).join(', ')}`
                  : 'Tous les accessoires de l’entrée sont présents'
              }
            />
            <Row
              label="Carrosserie"
              entry={(inC.body_damages ?? []).length ? `${(inC.body_damages ?? []).length} dégât(s) relevé(s)` : 'Aucun dégât'}
              exit={(outC.body_damages ?? []).length ? `${(outC.body_damages ?? []).length} dégât(s) relevé(s)` : 'Aucun dégât'}
              bad={cmp.newDamages.length > 0}
              note={
                cmp.newDamages.length > 0
                  ? `Nouveau : ${cmp.newDamages.map((d) => `${zoneLabel(d.zone)} (${damageLabel(d.type)}${d.comment ? `, ${d.comment}` : ''})`).join(' ; ')}`
                  : undefined
              }
            />
            <Row
              label="Observations"
              entry={<span className="whitespace-pre-line">{entry.observations || 'Aucune'}</span>}
              exit={<span className="whitespace-pre-line">{exit.observations || 'Aucune'}</span>}
            />
          </tbody>
        </table>
      </div>
    </section>
  );
}
