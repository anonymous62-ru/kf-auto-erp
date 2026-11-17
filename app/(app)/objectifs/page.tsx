import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { ObjectivesManager } from '@/components/objectives/objectives-manager';
import { PeriodFilter } from '@/components/objectives/period-filter';
import { hasPermission } from '@/lib/permissions';
import {
  getObjectivesProgress,
  getSalesPeople,
  getVehicleModels,
} from '@/lib/objectives/queries';
import { formatPeriod, resolvePeriodFilter } from '@/lib/objectives/periods';

// Objectifs commerciaux en nombre de véhicules (demande du 16/11/2026) :
// fixés par la direction et le responsable commercial, par commercial, par
// période et éventuellement par modèle. Le réalisé vient des factures émises.
export default async function ObjectivesPage({ searchParams }: { searchParams: Promise<{ periode?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  // Droit gerer_objectifs de la matrice des droits (migration 0058).
  if (!(await hasPermission('gerer_objectifs'))) redirect('/dashboard');

  const { periode } = await searchParams;
  const period = resolvePeriodFilter(periode);
  const [{ rows, error }, people, models] = await Promise.all([
    getObjectivesProgress(period.range.from, period.range.to),
    getSalesPeople(),
    getVehicleModels(),
  ]);

  return (
    <div>
      <PageHeader
        title="Objectifs commerciaux"
        description="En nombre de véhicules vendus, par commercial et par période. Le réalisé est compté sur les factures émises, avoirs déduits."
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PeriodFilter basePath="/objectifs" active={period.key} />
        <span className="text-[13px] text-encre-3">{formatPeriod(period.range.from, period.range.to)}</span>
      </div>
      {error && (
        <p className="mb-4 rounded-md border border-[#F3C2C4] bg-rouge-clair px-3 py-2 text-sm text-rouge" role="alert">
          {error}
        </p>
      )}
      <ObjectivesManager rows={rows} people={people} models={models} />
    </div>
  );
}
