import Link from 'next/link';
import { ObjectivesTable } from '@/components/objectives/objectives-table';
import { PeriodFilter } from '@/components/objectives/period-filter';
import { getObjectivesProgress, getSalesPeople } from '@/lib/objectives/queries';
import { formatPeriod, resolvePeriodFilter } from '@/lib/objectives/periods';

// Tableau de bord : avancement des objectifs (en véhicules).
//   - direction et responsable commercial : tous les commerciaux ;
//   - commercial : ses propres objectifs (filtrés par la base).
export async function TeamObjectives({ manage, periode }: { manage: boolean; periode?: string }) {
  const period = resolvePeriodFilter(periode);
  const [{ rows, error }, people] = await Promise.all([
    getObjectivesProgress(period.range.from, period.range.to),
    manage ? getSalesPeople() : Promise.resolve([]),
  ]);

  // Un commercial sans objectif ne voit pas la section (rien à suivre).
  if (!manage && rows.length === 0 && period.key === 'mois' && !error) return null;

  const withObjective = new Set(rows.map((r) => r.user_id));
  const without = people.filter((p) => p.is_active && !withObjective.has(p.id));

  return (
    <section id="objectifs" className="card scroll-mt-4 overflow-hidden" aria-labelledby="objectifs-t">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2 px-4 pb-3 pt-4">
        <div className="min-w-0">
          <h2 id="objectifs-t" className="font-display text-[19px] font-bold tracking-[-0.01em]">
            {manage ? "Objectifs de l'équipe" : 'Mes objectifs'}
          </h2>
          <p className="text-[12.5px] text-encre-3">
            {formatPeriod(period.range.from, period.range.to)}, en véhicules facturés
          </p>
        </div>
        {manage && (
          <Link href="/objectifs" className="ml-auto text-[13px] font-medium text-[#2357A6] hover:underline">
            Gérer les objectifs
          </Link>
        )}
        <div className="w-full">
          <PeriodFilter basePath="/dashboard" active={period.key} hash="objectifs" />
        </div>
      </div>
      {error ? (
        <p className="px-4 pb-5 text-[13px] text-rouge">{error}</p>
      ) : rows.length === 0 ? (
        <p className="border-t border-trait-2 px-4 pb-5 pt-3 text-[13px] text-encre-3">
          Aucun objectif sur cette période.{' '}
          {manage && (
            <Link href="/objectifs" className="font-medium text-[#2357A6] hover:underline">
              Fixer les objectifs
            </Link>
          )}
        </p>
      ) : (
        <div className="border-t border-trait">
          <ObjectivesTable rows={rows} showPerson={manage} />
        </div>
      )}
      {manage && without.length > 0 && rows.length > 0 && (
        <p className="border-t border-trait-2 px-4 py-3 text-[12.5px] text-encre-3">
          Sans objectif sur la période : {without.map((p) => p.full_name || 'Sans nom').join(', ')}
        </p>
      )}
    </section>
  );
}
