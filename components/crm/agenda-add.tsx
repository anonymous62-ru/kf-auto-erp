'use client';

import { useState } from 'react';
import { EventForm } from '@/components/crm/event-form';
import { IconPlus } from '@/components/icons';

export function AgendaAdd({ commercials, date }: { commercials: { id: string; full_name: string }[] | null; date: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-primary">
        <IconPlus className="w-4 h-4" /> Ajouter
      </button>
    );
  }
  return (
    <div className="card p-4 space-y-2 w-full">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900">Nouvel événement</p>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-500 underline">
          Fermer
        </button>
      </div>
      <EventForm commercials={commercials} defaults={{ date }} onDone={() => setOpen(false)} />
    </div>
  );
}
