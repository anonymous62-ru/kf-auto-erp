'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateProspectStatus, type ProspectStatus } from '@/lib/prospects/actions';

const OPTIONS: { value: ProspectStatus; label: string }[] = [
  { value: 'nouveau', label: 'Nouveau' },
  { value: 'contacte', label: 'Contacté' },
  { value: 'interesse', label: 'Intéressé' },
  { value: 'rdv_planifie', label: 'RDV planifié' },
  { value: 'negociation', label: 'Négociation' },
  { value: 'converti', label: 'Converti' },
  { value: 'perdu', label: 'Perdu' },
];

export function ProspectStatusSelect({ prospectId, status }: { prospectId: string; status: ProspectStatus }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <select
      value={status}
      disabled={isPending}
      onChange={(e) => {
        const value = e.target.value as ProspectStatus;
        startTransition(async () => {
          await updateProspectStatus(prospectId, value);
          router.refresh();
        });
      }}
      className="text-xs border rounded-md px-2 py-1 text-gray-700"
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
