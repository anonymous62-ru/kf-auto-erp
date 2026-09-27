'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { getProspects, type ProspectStatus } from '@/lib/prospects/actions';

type ProspectRow = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  status: ProspectStatus;
  vehicle_interest?: string | null;
  next_relance_at?: string | null;
};

const STATUS_LABELS: Record<ProspectStatus, string> = {
  nouveau: 'Nouveau',
  contacte: 'Contacté',
  interesse: 'Intéressé',
  rdv_planifie: 'RDV planifié',
  negociation: 'Négociation',
  converti: 'Converti',
  perdu: 'Perdu',
};

const STATUS_COLORS: Record<ProspectStatus, string> = {
  nouveau: 'bg-gray-100 text-gray-600',
  contacte: 'bg-blue-100 text-blue-700',
  interesse: 'bg-amber-100 text-amber-700',
  rdv_planifie: 'bg-purple-100 text-purple-700',
  negociation: 'bg-orange-100 text-orange-700',
  converti: 'bg-green-100 text-green-700',
  perdu: 'bg-red-100 text-red-500',
};

const TABS: { value: ProspectStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'nouveau', label: 'Nouveau' },
  { value: 'contacte', label: 'Contacté' },
  { value: 'interesse', label: 'Intéressé' },
  { value: 'rdv_planifie', label: 'RDV' },
  { value: 'negociation', label: 'Négociation' },
  { value: 'converti', label: 'Converti' },
  { value: 'perdu', label: 'Perdu' },
];

function isOverdue(nextRelanceAt?: string | null) {
  return !!nextRelanceAt && new Date(nextRelanceAt) < new Date();
}

export function ProspectList({ initialProspects }: { initialProspects: ProspectRow[] }) {
  const [tab, setTab] = useState<ProspectStatus | 'all'>('all');
  const [prospects, setProspects] = useState(initialProspects);
  const [isPending, startTransition] = useTransition();

  function handleTab(value: ProspectStatus | 'all') {
    setTab(value);
    startTransition(async () => {
      setProspects(await getProspects(value === 'all' ? undefined : value));
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => handleTab(t.value)}
            className={`text-xs px-2.5 py-1.5 rounded-full whitespace-nowrap border ${
              tab === t.value ? 'bg-kf-navy text-white border-kf-navy' : 'text-gray-600 border-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isPending && <p className="text-xs text-gray-400">Chargement...</p>}
      {!isPending && prospects.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-6">Aucun prospect dans cette catégorie.</p>
      )}

      <div className="space-y-2">
        {prospects.map((p) => (
          <Link key={p.id} href={`/prospects/${p.id}`} className="block bg-white rounded-lg border p-3 text-sm hover:bg-gray-50">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Sans nom'}</p>
                <p className="text-gray-500 text-xs">
                  {p.phone} {p.vehicle_interest ? `- ${p.vehicle_interest}` : ''}
                </p>
                {isOverdue(p.next_relance_at) && p.status !== 'converti' && p.status !== 'perdu' && (
                  <p className="text-xs text-kf-red mt-0.5">Relance en retard</p>
                )}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[p.status]}`}>
                {STATUS_LABELS[p.status]}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
