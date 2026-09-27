'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createAppointment, updateAppointmentStatus, type AppointmentStatus } from '@/lib/prospects/actions';

type Appointment = {
  id: string;
  scheduled_at: string;
  location: string | null;
  notes: string | null;
  status: AppointmentStatus;
};

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  planifie: 'Planifié',
  confirme: 'Confirmé',
  realise: 'Réalisé',
  annule: 'Annulé',
  absent: 'Absent',
};

const STATUS_COLORS: Record<AppointmentStatus, string> = {
  planifie: 'bg-purple-100 text-purple-700',
  confirme: 'bg-blue-100 text-blue-700',
  realise: 'bg-green-100 text-green-700',
  annule: 'bg-gray-100 text-gray-500',
  absent: 'bg-red-100 text-red-500',
};

export function ProspectAppointments({ prospectId, appointments }: { prospectId: string; appointments: Appointment[] }) {
  const [scheduledAt, setScheduledAt] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      try {
        await createAppointment({
          prospectId,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : '',
          location: location || undefined,
          notes: notes || undefined,
        });
        setScheduledAt('');
        setLocation('');
        setNotes('');
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur');
      }
    });
  }

  function handleStatus(id: string, status: AppointmentStatus) {
    startTransition(async () => {
      await updateAppointmentStatus(id, prospectId, status);
      router.refresh();
    });
  }

  return (
    <div className="card p-4 space-y-3">
      <h2 className="text-sm font-semibold text-kf-navy">Rendez-vous</h2>

      <div className="space-y-2 bg-gray-50 rounded-md p-2.5">
        <label className="text-xs text-gray-500 block">
          Date et heure
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
          />
        </label>
        <input
          placeholder="Lieu (showroom, chez le client...)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="w-full border rounded-md px-2 py-1.5 text-sm"
        />
        <textarea
          placeholder="Notes (optionnel)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full border rounded-md px-2 py-1.5 text-sm"
          rows={2}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          onClick={handleCreate}
          disabled={isPending || !scheduledAt}
          className="w-full bg-kf-navy text-white rounded-md py-2 text-sm font-medium disabled:opacity-50"
        >
          {isPending ? 'Enregistrement...' : 'Planifier ce rendez-vous'}
        </button>
      </div>

      <div className="space-y-2">
        {appointments.length === 0 && <p className="text-xs text-gray-400">Aucun rendez-vous planifié.</p>}
        {appointments.map((a) => (
          <div key={a.id} className="border rounded-md p-2.5 text-sm space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">
                  {new Date(a.scheduled_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
                {a.location && <p className="text-xs text-gray-500">{a.location}</p>}
                {a.notes && <p className="text-xs text-gray-500">{a.notes}</p>}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[a.status]}`}>
                {STATUS_LABELS[a.status]}
              </span>
            </div>
            {(a.status === 'planifie' || a.status === 'confirme') && (
              <div className="flex gap-1.5 pt-1">
                {a.status === 'planifie' && (
                  <button
                    onClick={() => handleStatus(a.id, 'confirme')}
                    className="text-xs px-2 py-1 rounded-md border border-blue-200 text-blue-700"
                  >
                    Confirmer
                  </button>
                )}
                <button
                  onClick={() => handleStatus(a.id, 'realise')}
                  className="text-xs px-2 py-1 rounded-md border border-green-200 text-green-700"
                >
                  Marquer réalisé
                </button>
                <button
                  onClick={() => handleStatus(a.id, 'absent')}
                  className="text-xs px-2 py-1 rounded-md border border-red-200 text-red-600"
                >
                  Absent
                </button>
                <button
                  onClick={() => handleStatus(a.id, 'annule')}
                  className="text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-500"
                >
                  Annuler
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
