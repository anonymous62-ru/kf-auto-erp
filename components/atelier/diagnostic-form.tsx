'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateRepairOrderDiagnostic } from '@/lib/atelier/actions';
import { IconCheck } from '@/components/icons';

export function DiagnosticForm({
  repairOrderId,
  diagnostic,
  laborHoursPlanned,
  laborHoursActual,
  laborRate,
  vehicleMileageIn,
}: {
  repairOrderId: string;
  diagnostic: string | null;
  laborHoursPlanned: number;
  laborHoursActual: number;
  laborRate: number;
  vehicleMileageIn: number | null;
}) {
  const [form, setForm] = useState({
    diagnostic: diagnostic ?? '',
    laborHoursPlanned,
    laborHoursActual,
    laborRate,
    vehicleMileageIn: vehicleMileageIn ?? 0,
  });
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(false);
    startTransition(async () => {
      await updateRepairOrderDiagnostic({ id: repairOrderId, ...form });
      setSuccess(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="card p-4 space-y-2">
      <h2 className="text-sm font-semibold text-kf-navy">Diagnostic et main d'œuvre</h2>
      <textarea
        className="input"
        rows={3}
        value={form.diagnostic}
        onChange={(e) => setForm((f) => ({ ...f, diagnostic: e.target.value }))}
        placeholder="Diagnostic technique"
      />
      <div className="grid grid-cols-3 gap-2">
        <label className="field-label">
          H. prévues
          <input type="number" className="input mt-1" value={form.laborHoursPlanned} onChange={(e) => setForm((f) => ({ ...f, laborHoursPlanned: Number(e.target.value) }))} />
        </label>
        <label className="field-label">
          H. réelles
          <input type="number" className="input mt-1" value={form.laborHoursActual} onChange={(e) => setForm((f) => ({ ...f, laborHoursActual: Number(e.target.value) }))} />
        </label>
        <label className="field-label">
          Taux horaire
          <input type="number" className="input mt-1" value={form.laborRate} onChange={(e) => setForm((f) => ({ ...f, laborRate: Number(e.target.value) }))} />
        </label>
      </div>
      <label className="field-label">
        Kilométrage à l'entrée
        <input type="number" className="input mt-1" value={form.vehicleMileageIn} onChange={(e) => setForm((f) => ({ ...f, vehicleMileageIn: Number(e.target.value) }))} />
      </label>
      <button type="submit" className="btn-secondary w-full text-sm" disabled={isPending}>
        {success && <IconCheck className="w-3.5 h-3.5" />} {isPending ? 'Enregistrement...' : 'Enregistrer'}
      </button>
    </form>
  );
}
