import type { ObjectiveProgress } from '@/lib/objectives/queries';
import { formatPeriod } from '@/lib/objectives/periods';
import { ProgressBar } from '@/components/objectives/progress-bar';

// Tableau d'avancement des objectifs, regroupé par commercial : objectif,
// réalisé (véhicules facturés), pourcentage et barre de progression.
// `actions` ajoute une colonne (modifier, supprimer) sur la page de gestion.
export function ObjectivesTable({
  rows,
  showPerson = true,
  actions,
}: {
  rows: ObjectiveProgress[];
  showPerson?: boolean;
  actions?: (row: ObjectiveProgress) => React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            {showPerson && <th>Commercial</th>}
            <th>Modèle</th>
            <th>Période</th>
            <th className="num">Objectif</th>
            <th className="num">Réalisé</th>
            <th className="num">%</th>
            <th className="w-[22%] min-w-[120px]">
              <span className="sr-only">Avancement</span>
            </th>
            {actions && (
              <th>
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const firstOfPerson = i === 0 || rows[i - 1].user_id !== r.user_id;
            return (
              <tr key={r.objective_id}>
                {showPerson && (
                  <td className="whitespace-nowrap font-medium">{firstOfPerson ? r.user_name || 'Sans nom' : ''}</td>
                )}
                <td className="whitespace-nowrap">{r.product_label ?? 'Tous modèles'}</td>
                <td className="whitespace-nowrap text-encre-2">{formatPeriod(r.period_start, r.period_end)}</td>
                <td className="num whitespace-nowrap">{r.target_units}</td>
                <td className="num whitespace-nowrap">{r.achieved_units}</td>
                <td className={`num whitespace-nowrap font-medium ${r.pct >= 100 ? 'text-[#12804F]' : ''}`}>{r.pct} %</td>
                <td>
                  <ProgressBar
                    pct={r.pct}
                    label={`${r.user_name}, ${r.product_label ?? 'tous modèles'} : ${r.achieved_units} sur ${r.target_units}`}
                  />
                </td>
                {actions && <td className="whitespace-nowrap text-right">{actions(r)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
