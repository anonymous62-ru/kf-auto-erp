'use client';

import { useState, useTransition } from 'react';
import { deleteDocument } from '@/lib/documents/actions';
import { formatCFA } from '@/lib/documents/calculations';
import { IconAlert } from '@/components/icons';

type Step = 'idle' | 'confirm' | 'confirm-payments';

export function DeleteDocumentButton({ documentId, documentNumber }: { documentId: string; documentNumber: string | null }) {
  const [step, setStep] = useState<Step>('idle');
  const [paidAmount, setPaidAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const label = documentNumber ?? 'ce document';

  function run(withPayments: boolean) {
    if (isPending) return; // garde anti double-clic
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteDocument(documentId, withPayments);
        // En cas de succès, la Server Action redirige : on n'arrive ici
        // qu'en cas de refus.
        if (result?.needsPaymentConfirmation) {
          setPaidAmount(result.paidAmount);
          setStep('confirm-payments');
        } else if (result?.error) {
          setError(result.error);
        }
      } catch (e) {
        if (e instanceof Error && (e.message === 'NEXT_REDIRECT' || 'digest' in e)) return;
        setError('La suppression a échoué. Réessayez.');
      }
    });
  }

  if (step === 'idle') {
    return (
      <button
        onClick={() => setStep('confirm')}
        className="w-full rounded-lg border border-red-200 bg-white py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
      >
        Supprimer ce document
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
      {step === 'confirm' ? (
        <p className="text-sm text-red-800">
          Supprimer définitivement <strong>{label}</strong> ? Cette action est irréversible.
        </p>
      ) : (
        <div className="flex gap-2.5 text-sm text-red-800">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <strong>{label}</strong> a <strong>{formatCFA(paidAmount)}</strong> de paiements enregistrés. Les supprimer
            efface aussi ces encaissements de l&apos;historique (à réserver aux documents de test ou saisis par erreur).
            Le stock éventuellement retiré par cette facture sera remis en place.
          </p>
        </div>
      )}
      {error && <p className="rounded-md bg-white px-3 py-2 text-sm text-red-700 border border-red-200">{error}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          onClick={() => run(step === 'confirm-payments')}
          disabled={isPending}
          className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
        >
          {isPending
            ? 'Suppression...'
            : step === 'confirm-payments'
            ? 'Supprimer le document et ses paiements'
            : 'Oui, supprimer'}
        </button>
        <button
          onClick={() => {
            setStep('idle');
            setError(null);
          }}
          disabled={isPending}
          className="flex-1 rounded-lg border border-gray-300 bg-white py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
