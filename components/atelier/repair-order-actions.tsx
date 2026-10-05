'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { validateQuote, refuseQuote, updateRepairOrderStatus, invoiceRepairOrder } from '@/lib/atelier/actions';
import { IconCheck, IconX } from '@/components/icons';

type Status = 'ouvert' | 'en_cours' | 'en_attente_pieces' | 'termine' | 'facture' | 'annule';

export function RepairOrderActions({
  repairOrderId,
  status,
  quoteStatus,
  hasInvoice,
}: {
  repairOrderId: string;
  status: Status;
  quoteStatus: 'en_attente' | 'valide' | 'refuse' | null;
  hasInvoice: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function run(fn: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (result && typeof result === 'object' && 'error' in result && (result as { error?: string }).error) {
          setError((result as { error: string }).error);
          return;
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur');
      }
    });
  }

  function handleInvoice() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await invoiceRepairOrder(repairOrderId);
        router.push(`/documents/${result.documentId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur');
      }
    });
  }

  return (
    <div className="card p-4 space-y-3">
      <h2 className="text-sm font-semibold text-kf-navy">Statut et devis</h2>

      {quoteStatus === 'en_attente' && status !== 'annule' && (
        <div className="flex gap-2">
          <button onClick={() => run(() => validateQuote(repairOrderId))} disabled={isPending} className="btn-primary flex-1 text-sm">
            <IconCheck className="w-3.5 h-3.5" /> Valider le devis (réserve les pièces)
          </button>
          <button onClick={() => run(() => refuseQuote(repairOrderId))} disabled={isPending} className="btn-danger-ghost flex-1 text-sm">
            <IconX className="w-3.5 h-3.5" /> Refuser
          </button>
        </div>
      )}

      {quoteStatus === 'valide' && status !== 'termine' && status !== 'facture' && status !== 'annule' && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => run(() => updateRepairOrderStatus(repairOrderId, 'en_attente_pieces'))} disabled={isPending} className="btn-secondary text-sm">
            En attente pièces
          </button>
          <button onClick={() => run(() => updateRepairOrderStatus(repairOrderId, 'termine'))} disabled={isPending} className="btn-primary text-sm">
            Marquer terminé
          </button>
          <button onClick={() => run(() => updateRepairOrderStatus(repairOrderId, 'annule'))} disabled={isPending} className="btn-danger-ghost text-sm">
            Annuler l'OR
          </button>
        </div>
      )}

      {status === 'termine' && !hasInvoice && (
        <button onClick={handleInvoice} disabled={isPending} className="btn-primary w-full text-sm">
          {isPending ? 'Facturation...' : "Facturer l'ordre de réparation"}
        </button>
      )}

      {hasInvoice && <p className="text-xs text-green-600">Cet ordre de réparation a déjà été facturé.</p>}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
