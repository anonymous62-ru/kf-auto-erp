'use client';

import { useState, useTransition } from 'react';
import { cancelDraftInvoice, createAvoir, type AvoirLineInput } from '@/lib/documents/invoice-actions';
import { formatCFA } from '@/lib/documents/calculations';

function isRedirect(e: unknown) {
  return e instanceof Error && (e.message === 'NEXT_REDIRECT' || 'digest' in e);
}

function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>;
}

// ---------------------------------------------------------------------------
// Annuler une facture pas encore payée (le numéro reste, marqué annulé)
// ---------------------------------------------------------------------------
export function CancelDraftInvoiceButton({ documentId, documentNumber }: { documentId: string; documentNumber: string | null }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-md border border-red-200 bg-white py-2.5 text-sm font-medium text-red-600 hover:bg-red-50"
      >
        Annuler la facture
      </button>
    );
  }

  return (
    <div className="card space-y-3 border-red-200 p-4">
      <p className="text-sm text-gray-700">
        La facture <strong>{documentNumber}</strong> restera visible avec la mention « Annulée » : son numéro n&apos;est
        jamais réutilisé. Le stock et les véhicules sont libérés et la commande redevient à facturer. Pour une
        simple erreur (prix, ligne, client), utilisez plutôt « Modifier ».
      </p>
      <label className="block">
        <span className="field-label">Motif de l&apos;annulation</span>
        <input
          className="input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex. : mauvais client sélectionné"
        />
      </label>
      <ErrorBox message={error} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            if (isPending) return;
            setError(null);
            startTransition(async () => {
              const result = await cancelDraftInvoice(documentId, reason);
              if (result?.error) setError(result.error);
              else setOpen(false);
            });
          }}
          className="flex-1 rounded-md bg-red-600 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
        >
          {isPending ? 'Annulation...' : 'Confirmer l’annulation'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary flex-1 justify-center">
          Retour
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Créer un avoir (total ou partiel) sur une facture déjà payée
// ---------------------------------------------------------------------------
type Line = { designation: string; amount: string; taxRate: string };

export function CreateAvoirForm({
  factureId,
  factureNumber,
  remaining,
  hasPartial,
}: {
  factureId: string;
  factureNumber: string | null;
  remaining: number;
  hasPartial: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'total' | 'partiel'>(hasPartial ? 'partiel' : 'total');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<Line[]>([{ designation: '', amount: '', taxRate: '0' }]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const parsed: AvoirLineInput[] = lines.map((l) => ({
    designation: l.designation,
    quantity: 1,
    unitPrice: Number(l.amount.replace(/\s/g, '').replace(',', '.')) || 0,
    taxRate: Number(l.taxRate) || 0,
  }));
  const partialTotal = parsed.reduce((s, l) => s + l.unitPrice * (1 + l.taxRate / 100), 0);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary w-full justify-center">
        Créer un avoir
      </button>
    );
  }

  return (
    <div className="card space-y-4 p-4">
      <div>
        <p className="text-sm font-semibold text-gray-900">Avoir sur la facture {factureNumber}</p>
        <p className="mt-1 text-xs text-gray-500">Montant restant à créditer : {formatCFA(remaining)}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={hasPartial}
          onClick={() => setMode('total')}
          className={`rounded-md border px-3 py-2 text-left text-sm ${
            mode === 'total' ? 'border-kf-navy bg-kf-navy/5 text-kf-navy' : 'border-gray-200 text-gray-700'
          } disabled:opacity-50`}
        >
          <span className="block font-medium">Avoir total</span>
          <span className="block text-xs text-gray-500">Annule la facture</span>
        </button>
        <button
          type="button"
          onClick={() => setMode('partiel')}
          className={`rounded-md border px-3 py-2 text-left text-sm ${
            mode === 'partiel' ? 'border-kf-navy bg-kf-navy/5 text-kf-navy' : 'border-gray-200 text-gray-700'
          }`}
        >
          <span className="block font-medium">Avoir partiel</span>
          <span className="block text-xs text-gray-500">Remise, erreur de prix</span>
        </button>
      </div>

      {mode === 'total' ? (
        <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
          Toutes les lignes de la facture sont reprises. La facture passe « Annulée », le stock et les véhicules sont
          libérés et la commande redevient à facturer : une nouvelle facture corrigée pourra être établie.
        </p>
      ) : (
        <div className="space-y-2">
          {lines.map((line, index) => (
            <div key={index} className="grid grid-cols-[1fr_8rem_4.5rem_auto] items-end gap-2">
              <label className="block">
                {index === 0 && <span className="field-label">Désignation</span>}
                <input
                  className="input"
                  value={line.designation}
                  onChange={(e) => setLines(lines.map((l, i) => (i === index ? { ...l, designation: e.target.value } : l)))}
                  placeholder="Ex. : remise commerciale"
                />
              </label>
              <label className="block">
                {index === 0 && <span className="field-label">Montant HT</span>}
                <input
                  className="input text-right tabular-nums"
                  inputMode="numeric"
                  value={line.amount}
                  onChange={(e) => setLines(lines.map((l, i) => (i === index ? { ...l, amount: e.target.value } : l)))}
                />
              </label>
              <label className="block">
                {index === 0 && <span className="field-label">TVA %</span>}
                <input
                  className="input text-right tabular-nums"
                  inputMode="numeric"
                  value={line.taxRate}
                  onChange={(e) => setLines(lines.map((l, i) => (i === index ? { ...l, taxRate: e.target.value } : l)))}
                />
              </label>
              <button
                type="button"
                disabled={lines.length === 1}
                onClick={() => setLines(lines.filter((_, i) => i !== index))}
                className="h-9 px-2 text-sm text-gray-400 hover:text-red-600 disabled:opacity-30"
                aria-label="Retirer la ligne"
              >
                Retirer
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setLines([...lines, { designation: '', amount: '', taxRate: '0' }])}
              className="btn-link text-sm"
            >
              Ajouter une ligne
            </button>
            <p className="text-sm text-gray-700">
              Total TTC : <span className="font-semibold tabular-nums">{formatCFA(partialTotal)}</span>
            </p>
          </div>
        </div>
      )}

      <label className="block">
        <span className="field-label">Motif (imprimé sur l&apos;avoir)</span>
        <input
          className="input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex. : erreur sur le nom du client"
        />
      </label>

      <ErrorBox message={error} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            if (isPending) return;
            setError(null);
            startTransition(async () => {
              try {
                const result = await createAvoir(factureId, reason, mode === 'total' ? null : parsed);
                if (result?.error) setError(result.error);
              } catch (e) {
                if (isRedirect(e)) throw e;
                setError("L'avoir n'a pas pu être créé. Réessayez.");
              }
            });
          }}
          className="btn-primary flex-1 justify-center"
        >
          {isPending ? 'Création...' : mode === 'total' ? 'Créer l’avoir total' : 'Créer l’avoir partiel'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary flex-1 justify-center">
          Retour
        </button>
      </div>
    </div>
  );
}
