'use client';

import { useState, useTransition } from 'react';
import { createPayment, type PaymentMethod } from '@/lib/payments/actions';
import { useRouter } from 'next/navigation';
import { ReceiptSendActions } from '@/components/payments/receipt-send-actions';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'especes', label: 'Espèces' },
  { value: 'virement', label: 'Virement' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'mobile_money_flooz', label: 'Flooz (Moov)' },
  { value: 'mobile_money_tmoney', label: 'TMoney (Togocom)' },
  { value: 'autre', label: 'Autre' },
];

export function PaymentForm({
  documentId,
  documentNumber,
  clientId,
  balanceDue,
  clientPhone,
  clientEmail,
}: {
  documentId: string;
  documentNumber?: string | null;
  clientId: string;
  balanceDue: number;
  clientPhone?: string | null;
  clientEmail?: string | null;
}) {
  const [amount, setAmount] = useState(balanceDue);
  const [method, setMethod] = useState<PaymentMethod>('especes');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [justPaid, setJustPaid] = useState<{ amount: number; remaining: number } | null>(null);
  const router = useRouter();

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        await createPayment({ documentId, clientId, amount, paymentMethod: method, reference });
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
        onClick={() => setOpen(true)}
        className="w-full border border-kf-navy text-kf-navy rounded-md py-2.5 text-sm font-medium"
      >
        Enregistrer un paiement
      </button>
    );
  }

  return (
    <div className="bg-white rounded-lg border p-3 space-y-2">
      <p className="text-xs text-gray-500">Nouveau paiement</p>
      <label className="text-xs text-gray-500 block">
        Montant (FCFA)
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
        />
      </label>
      <label className="text-xs text-gray-500 block">
        Moyen de paiement
        <select
          value={method}
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
        Référence (optionnel)
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
        />
      </label>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={handleSubmit} disabled={isPending} className="flex-1 bg-kf-navy text-white rounded-md py-2 text-sm">
          {isPending ? 'Enregistrement...' : 'Confirmer'}
        </button>
        <button onClick={() => setOpen(false)} className="flex-1 border rounded-md py-2 text-sm">
          Annuler
        </button>
      </div>
    </div>
  );
}
