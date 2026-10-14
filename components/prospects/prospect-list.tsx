'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { getProspects, type ProspectStatus } from '@/lib/prospects/actions';

type ProspectRow = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  contact_name?: string | null;
  sector?: string | null;
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
  nouveau: 'badge-gray',
  contacte: 'badge-blue',
  interesse: 'badge-amber',
  rdv_planifie: 'badge-indigo',
  negociation: 'badge-orange',
  converti: 'badge-green',
  perdu: 'badge-red',
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

export function ProspectList({ initialProspects, assignedTo }: { initialProspects: ProspectRow[]; assignedTo?: string }) {
  const [tab, setTab] = useState<ProspectStatus | 'all'>('all');
  const [prospects, setProspects] = useState(initialProspects);
  const [isPending, startTransition] = useTransition();

  function handleTab(value: ProspectStatus | 'all') {
    setTab(value);
    startTransition(async () => {
      setProspects(await getProspects(value === 'all' ? undefined : value, assignedTo));
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => handleTab(t.value)}
            className={`chip ${tab === t.value ? 'chip-active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isPending && <p className="text-xs text-gray-400">Chargement...</p>}
      {!isPending && prospects.length === 0 && (
        <div className="card px-4 py-10 text-center">
          <p className="text-sm font-medium">Aucun lead dans cette catégorie</p>
          <p className="mt-1 text-[13px] text-gray-500">Ajoutez un lead ou importez votre fichier de contacts.</p>
          <Link href="/prospects/new" className="btn-primary mt-4">
            Nouveau lead
          </Link>
        </div>
      )}

      <div className={prospects.length ? 'table-wrap divide-y divide-gray-100' : 'hidden'}>
        {prospects.map((p) => (
          <Link key={p.id} href={`/prospects/${p.id}`} className="block px-3 py-3 text-sm hover:bg-gray-50">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">
                  {p.company_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Sans nom'}
                </p>
                {p.contact_name && <p className="text-gray-600 text-xs">{p.contact_name}</p>}
                <p className="text-gray-500 text-xs">
                  {[p.phone, p.sector, p.vehicle_interest].filter(Boolean).join(' · ')}
                </p>
                {isOverdue(p.next_relance_at) && p.status !== 'converti' && p.status !== 'perdu' && (
                  <p className="text-xs text-kf-red mt-0.5">Relance en retard</p>
                )}
              </div>
              <span className={`shrink-0 ${STATUS_COLORS[p.status]}`}>
                {STATUS_LABELS[p.status]}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
