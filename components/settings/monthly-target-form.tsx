import Link from 'next/link';

// Les objectifs ne se fixent plus en F CFA ici (demande du 16/11/2026) : ils
// sont désormais en nombre de véhicules, par commercial, sur la page
// « Objectifs commerciaux ». Ce bloc renvoie simplement vers elle.
export function MonthlyTargetForm() {
  return (
    <section className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="section-title">Objectifs commerciaux</p>
        <p className="mt-0.5 text-[13px] text-encre-3">
          Fixés en nombre de véhicules vendus, par commercial, par période et par modèle. Ils alimentent le compte-tours du tableau de bord.
        </p>
      </div>
      <Link href="/objectifs" className="btn-secondary shrink-0">
        Fixer les objectifs
      </Link>
    </section>
  );
}
