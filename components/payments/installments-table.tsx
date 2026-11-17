'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { confirmPayment, setPaymentSchedule, type Installment } from '@/lib/payments/actions';
import { RelanceButton } from '@/components/payments/relance-button';
import { ScheduleEditor } from '@/components/payments/schedule-editor';
import {
  INSTALLMENT_STATUS_BADGE,
  INSTALLMENT_STATUS_LABEL,
  buildEqualSchedule,
  displayStatus,
  formatDateFR,
  formatFCFA,
  todayISO,
  validateSchedule,
  type InstallmentInput,
} from '@/lib/payments/schedule';

const METHOD_LABELS: Record<string, string> = {
  especes: 'Espèces',
  virement: 'Virement',
  cheque: 'Chèque',
  mobile_money_flooz: 'Flooz',
  mobile_money_tmoney: 'TMoney',
  autre: 'Autre',
};

type Unconfirmed = {
  id: string;
  amount: number;
  payment_method: string;
  payment_date: string;
  recorded_by_name: string | null;
};

export function InstallmentsTable({
  documentId,
  documentNumber,
  isInvoice,
  balanceDue,
  installments,
  unconfirmed,
  canEditSchedule,
  canConfirm,
  clientPhone,
  clientEmail,
}: {
  documentId: string;
  documentNumber: string | null;
  isInvoice: boolean;
  balanceDue: number;
  installments: Installment[];
  unconfirmed: Unconfirmed[];
  canEditSchedule: boolean;
  canConfirm: boolean;
  clientPhone?: string | null;
  clientEmail?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<InstallmentInput[]>([]);
  const today = todayISO();

  function startEdit() {
    const open = installments.filter((i) => i.status !== 'payee');
    let prev = '';
    const prefilled = open.map((i) => {
      // Dates conservées si possible, sinon décalées pour rester >= aujourd'hui
      // et strictement croissantes.
      let d = i.due_date < today ? today : i.due_date;
      if (prev && d <= prev) {
        const next = new Date(prev + 'T00:00:00Z');
        next.setUTCDate(next.getUTCDate() + 1);
        d = next.toISOString().slice(0, 10);
      }
      prev = d;
      return { amount: Math.round(i.amount - i.paid_amount), dueDate: d };
    });
    const sum = prefilled.reduce((s, r) => s + r.amount, 0);
    setRows(prefilled.length > 0 && Math.abs(sum - balanceDue) < 1 ? prefilled : buildEqualSchedule(balanceDue, Math.max(prefilled.length, 1), today));
    setError(null);
    setEditing(true);
  }

  const editError = editing ? validateSchedule(rows, balanceDue, today) : null;

  function saveSchedule() {
    if (isPending) return;
    if (editError) {
      setError(editError);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await setPaymentSchedule(documentId, rows);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function confirm(paymentId: string) {
    if (isPending || busyId) return;
    setBusyId(paymentId);
    setError(null);
    startTransition(async () => {
      const res = await confirmPayment(paymentId, documentId);
      setBusyId(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {unconfirmed.length > 0 && (
        <div className="card p-4 space-y-2">
          <h3 className="text-sm font-medium">Paiements en attente de confirmation</h3>
          <ul className="divide-y">
            {unconfirmed.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <span className="tabular-nums font-medium">{formatFCFA(p.amount)}</span>
                  <span className="text-gray-500">
                    {' '}
                    le {formatDateFR(p.payment_date)}, {METHOD_LABELS[p.payment_method] ?? p.payment_method}
                    {p.recorded_by_name ? `, saisi par ${p.recorded_by_name}` : ''}
                  </span>
                </span>
                {canConfirm ? (
                  <button
                    onClick={() => confirm(p.id)}
                    disabled={isPending || busyId !== null}
                    className="btn-secondary btn-sm disabled:opacity-50"
                  >
                    {busyId === p.id ? 'Confirmation...' : 'Confirmer le paiement'}
                  </button>
                ) : (
                  <span className="badge-amber">À confirmer par la comptable</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isInvoice && installments.length > 0 && (
        <div className="card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Échéancier</h3>
            {canEditSchedule && balanceDue >= 1 && !editing && (
              <button onClick={startEdit} disabled={isPending} className="btn-secondary btn-sm">
                Modifier l&apos;échéancier
              </button>
            )}
          </div>

          {installments.length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Date</th>
                    <th className="num">Montant</th>
                    <th className="num hidden sm:table-cell">Payé</th>
                    <th>Statut</th>
                    <th className="hidden md:table-cell" />
                  </tr>
                </thead>
                <tbody>
                  {installments.map((i) => {
                    const st = displayStatus(i.status, i.due_date);
                    return (
                      <tr key={i.id}>
                        <td className="tabular-nums">{i.seq}</td>
                        <td className="tabular-nums">{formatDateFR(i.due_date)}</td>
                        <td className="num font-medium">{formatFCFA(i.amount)}</td>
                        <td className="num hidden sm:table-cell">{formatFCFA(i.paid_amount)}</td>
                        <td>
                          <span className={INSTALLMENT_STATUS_BADGE[st]}>{INSTALLMENT_STATUS_LABEL[st]}</span>
                        </td>
                        <td className="hidden text-right md:table-cell">
                          {st !== 'payee' && (
                            <RelanceButton
                              documentId={documentId}
                              documentNumber={documentNumber}
                              balanceDue={balanceDue}
                              clientPhone={clientPhone}
                              clientEmail={clientEmail}
                              installment={{
                                seq: i.seq,
                                amount: i.amount - i.paid_amount,
                                dueDate: i.due_date,
                                overdue: st === 'en_retard',
                              }}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {editing && (
            <div className="rounded-md border border-gray-200 p-3 space-y-2">
              <p className="text-xs text-gray-600">
                Les échéances déjà payées sont conservées ; les autres sont remplacées par celles-ci, qui doivent couvrir le
                reste dû de <strong className="tabular-nums">{formatFCFA(balanceDue)}</strong>.
              </p>
              <ScheduleEditor
                remaining={balanceDue}
                startDate={today}
                minDate={today}
                rows={rows}
                onChange={setRows}
                disabled={isPending}
              />
              <div className="flex gap-2">
                <button
                  onClick={saveSchedule}
                  disabled={isPending || !!editError}
                  className="flex-1 bg-kf-navy text-white rounded-md py-2 text-sm disabled:opacity-50"
                >
                  {isPending ? 'Enregistrement...' : "Enregistrer l'échéancier"}
                </button>
                <button onClick={() => setEditing(false)} disabled={isPending} className="flex-1 border rounded-md py-2 text-sm">
                  Annuler
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}

      {!isInvoice && error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
