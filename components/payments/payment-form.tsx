'use client';

import { useRef, useState, useTransition } from 'react';
import { getScheduleSummary, recordPaymentWithSchedule, type PaymentMethod } from '@/lib/payments/actions';
import { useRouter } from 'next/navigation';
import { ReceiptSendActions } from '@/components/payments/receipt-send-actions';
import { ScheduleEditor } from '@/components/payments/schedule-editor';
import { buildEqualSchedule, formatFCFA, validateSchedule, type InstallmentInput } from '@/lib/payments/schedule';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'especes', label: 'Espèces' },
  { value: 'virement', label: 'Virement' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'mobile_money_flooz', label: 'Flooz (Moov)' },
  { value: 'mobile_money_tmoney', label: 'TMoney (Togocom)' },
  { value: 'autre', label: 'Autre' },
];

function newRequestId(): string {
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  // Repli (navigateurs anciens) : UUID v4 à partir de getRandomValues.
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x: number) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function PaymentForm({
  documentId,
  publicToken,
  documentNumber,
  balanceDue,
  clientPhone,
  clientEmail,
  documentType,
}: {
  documentId: string;
  publicToken: string;
  documentNumber?: string | null;
  clientId?: string;
  balanceDue: number;
  clientPhone?: string | null;
  clientEmail?: string | null;
  // L'échéancier n'existe que sur une facture.
  documentType?: string;
}) {
  const isInvoice = documentType === 'facture';
  const [amount, setAmount] = useState(balanceDue);
  const [method, setMethod] = useState<PaymentMethod>('especes');
  const [reference, setReference] = useState('');
  // Date du paiement : aujourd'hui par défaut, modifiable pour un paiement
  // reçu un autre jour (saisi en retard).
  const today = new Date().toISOString().slice(0, 10);
  const [paymentDate, setPaymentDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [justPaid, setJustPaid] = useState<{ amount: number; remaining: number } | null>(null);
  // Échéancier
  const [openSchedule, setOpenSchedule] = useState(0); // échéances non soldées déjà en place
  const [scheduling, setScheduling] = useState(true);
  const [rows, setRows] = useState<InstallmentInput[]>([]);
  // Identifiant de la saisie : rejoué tel quel en cas de double envoi, la base
  // n'enregistre alors qu'un seul paiement.
  const requestId = useRef<string>('');
  const router = useRouter();

  const remaining = Math.max(balanceDue - (Number.isFinite(amount) ? amount : 0), 0);
  const canSchedule = isInvoice && amount > 0 && remaining >= 1;
  const scheduleActive = canSchedule && scheduling;
  const scheduleError = scheduleActive ? validateSchedule(rows, remaining, paymentDate) : null;

  function regenerate(nextRemaining: number, date: string, count = rows.length || 1) {
    setRows(nextRemaining >= 1 ? buildEqualSchedule(nextRemaining, count, date) : []);
  }

  async function handleOpen() {
    requestId.current = newRequestId();
    setError(null);
    setOpen(true);
    if (isInvoice) {
      try {
        const summary = await getScheduleSummary(documentId);
        setOpenSchedule(summary.open);
        // Un échéancier est déjà en cours : le paiement s'y impute, on ne
        // propose pas d'en refaire un par défaut.
        setScheduling(summary.open === 0);
      } catch {
        setOpenSchedule(0);
      }
    }
    regenerate(Math.max(balanceDue - amount, 0), paymentDate);
  }

  function handleSubmit() {
    if (isPending) return; // garde anti double-clic
    if (scheduleActive && scheduleError) {
      setError(scheduleError);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await recordPaymentWithSchedule({
          documentId,
          amount,
          paymentMethod: method,
          reference,
          paymentDate,
          installments: scheduleActive ? rows : null,
          requestId: requestId.current,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        requestId.current = '';
        setOpen(false);
        setJustPaid({ amount, remaining: Math.max(balanceDue - amount, 0) });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur');
      }
    });
  }

  if (justPaid) {
    return (
      <ReceiptSendActions
        documentId={documentId}
        publicToken={publicToken}
        documentNumber={documentNumber ?? null}
        amountPaid={justPaid.amount}
        balanceDue={justPaid.remaining}
        clientPhone={clientPhone}
        clientEmail={clientEmail}
        onDismiss={() => {
          setJustPaid(null);
          router.refresh();
        }}
      />
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => void handleOpen()}
        className="w-full border border-kf-navy text-kf-navy rounded-md py-2.5 text-sm font-medium"
      >
        Enregistrer un paiement
      </button>
    );
  }

  return (
    <div className="bg-white rounded-lg border p-3 space-y-2">
      <p className="text-xs text-gray-500">Nouveau paiement (reste dû : {formatFCFA(balanceDue)})</p>
      <label className="text-xs text-gray-500 block">
        Montant versé (F CFA)
        <input
          type="number"
          inputMode="numeric"
          value={Number.isFinite(amount) ? amount : ''}
          disabled={isPending}
          onChange={(e) => {
            const v = e.target.value === '' ? NaN : Number(e.target.value);
            setAmount(v);
            regenerate(Math.max(balanceDue - (Number.isFinite(v) ? v : 0), 0), paymentDate);
          }}
          className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
        />
      </label>
      <label className="text-xs text-gray-500 block">
        Moyen de paiement
        <select
          value={method}
          disabled={isPending}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
        >
          {METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-gray-500 block">
        Date du paiement
        <input
          type="date"
          value={paymentDate}
          max={today}
          disabled={isPending}
          onChange={(e) => {
            setPaymentDate(e.target.value);
            regenerate(remaining, e.target.value || today);
          }}
          className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
        />
      </label>
      <label className="text-xs text-gray-500 block">
        Référence (optionnel)
        <input
          value={reference}
          disabled={isPending}
          onChange={(e) => setReference(e.target.value)}
          className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
        />
      </label>

      {canSchedule && (
        <div className="rounded-md border border-gray-200 p-2 space-y-2">
          <p className="text-xs text-gray-600">
            Reste après ce versement : <strong className="tabular-nums">{formatFCFA(remaining)}</strong>
          </p>
          {openSchedule > 0 && (
            <p className="text-xs text-gray-500">
              Un échéancier est en cours ({openSchedule} échéance{openSchedule > 1 ? 's' : ''} non soldée
              {openSchedule > 1 ? 's' : ''}) : ce versement solde les échéances dans l&apos;ordre.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={scheduling}
              disabled={isPending}
              onChange={(e) => {
                setScheduling(e.target.checked);
                if (e.target.checked) regenerate(remaining, paymentDate);
              }}
            />
            {openSchedule > 0 ? "Refaire l'échéancier du reste" : 'Échelonner le reste'}
          </label>
          {scheduling && (
            <ScheduleEditor
              remaining={remaining}
              startDate={paymentDate}
              minDate={paymentDate}
              rows={rows}
              onChange={setRows}
              disabled={isPending}
            />
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={isPending || !(amount > 0) || (scheduleActive && !!scheduleError)}
          className="flex-1 bg-kf-navy text-white rounded-md py-2 text-sm disabled:opacity-50"
        >
          {isPending ? 'Enregistrement...' : 'Confirmer'}
        </button>
        <button onClick={() => setOpen(false)} disabled={isPending} className="flex-1 border rounded-md py-2 text-sm">
          Annuler
        </button>
      </div>
    </div>
  );
}
