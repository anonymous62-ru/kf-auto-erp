'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createEvent } from '@/lib/crm/agenda';
import { EVENT_TYPES, type EventType } from '@/lib/crm/labels';

// Ajout d'un rendez-vous, d'une relance, d'un essai ou d'une livraison dans
// l'agenda. Utilisé sur la page Agenda et sur la fiche d'une affaire.
export function EventForm({
  defaults,
  commercials,
  onDone,
}: {
  defaults?: { title?: string; clientId?: string | null; leadId?: string | null; dealId?: string | null; date?: string };
  commercials?: { id: string; full_name: string }[] | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [type, setType] = useState<EventType>('rdv');
  const [title, setTitle] = useState(defaults?.title ?? '');
  const [date, setDate] = useState(defaults?.date ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('09:00');
  const [duration, setDuration] = useState(60);
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (isPending) return;
    setError(null);
    const start = new Date(`${date}T${time}`);
    if (Number.isNaN(start.getTime())) {
      setError('Date ou heure invalide.');
      return;
    }
    const end = new Date(start.getTime() + duration * 60_000);
    startTransition(async () => {
      const r = await createEvent({
        eventType: type,
        title: title || EVENT_TYPES.find((t) => t.value === type)?.label || 'Rendez-vous',
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        location,
        notes,
        assignedTo: assignedTo || null,
        clientId: defaults?.clientId ?? null,
        leadId: defaults?.leadId ?? null,
        dealId: defaults?.dealId ?? null,
      });
      if (r.error) {
        setError(r.error);
        return;
      }
      setTitle(defaults?.title ?? '');
      setNotes('');
      setLocation('');
      router.refresh();
      onDone?.();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {EVENT_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setType(t.value)}
            className={`rounded-md border px-2.5 py-1.5 text-xs ${
              type === t.value ? 'border-kf-navy bg-kf-navy text-white' : 'border-gray-200 text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Objet (ex. : essai Tiggo 7 avec M. Agbeko)" className="input" />
      <div className="grid gap-2 grid-cols-3">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input" />
        <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="input">
          <option value={30}>30 min</option>
          <option value={60}>1 h</option>
          <option value={90}>1 h 30</option>
          <option value={120}>2 h</option>
          <option value={240}>Demi-journée</option>
        </select>
      </div>
      <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Lieu (optionnel)" className="input" />
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes (optionnel)" className="input" />
      {commercials && commercials.length > 0 && (
        <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="input">
          <option value="">Dans mon agenda</option>
          {commercials.map((c) => (
            <option key={c.id} value={c.id}>
              Agenda de {c.full_name}
            </option>
          ))}
        </select>
      )}
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button type="button" onClick={submit} disabled={isPending} className="btn-primary">
        {isPending ? 'Ajout...' : 'Ajouter à l’agenda'}
      </button>
    </div>
  );
}
