'use client';

// Boutons du circuit de vente (proforma -> bon de commande -> facture).
// Chaque bouton est désactivé pendant l'action (useTransition) et la base
// refuse de toute façon une étape déjà franchie (anti double clic).

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { SignaturePad } from '@/components/documents/signature-pad';
import {
  checkCommande,
  issueFinalInvoice,
  markProformaAccepted,
  prepareInvoice,
  refuseInvoice,
  refuseProforma,
  resubmitCommande,
  submitProforma,
  validateInvoice,
  validateProforma,
  type WorkflowActionResult,
} from '@/lib/documents/workflow-actions';
import { convertDocument } from '@/lib/documents/actions';

function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
}

function ActionButton({
  label,
  pendingLabel,
  run,
  variant = 'btn-primary',
  disabled,
}: {
  label: string;
  pendingLabel: string;
  run: () => Promise<WorkflowActionResult>;
  variant?: string;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={isPending || disabled}
        onClick={() => {
          if (isPending) return;
          setError(null);
          startTransition(async () => {
            const result = await run();
            if (result?.error) setError(result.error);
            else router.refresh();
          });
        }}
        className={`${variant} w-full`}
      >
        {isPending ? pendingLabel : label}
      </button>
      <ErrorBox error={error} />
    </div>
  );
}

function ReasonAction({
  label,
  confirmLabel,
  placeholder,
  run,
}: {
  label: string;
  confirmLabel: string;
  placeholder: string;
  run: (reason: string) => Promise<WorkflowActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary w-full">
        {label}
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-red-200 bg-red-50/40 p-3">
      <label className="block">
        <span className="field-label">Motif (obligatoire)</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder={placeholder}
          className="input"
        />
      </label>
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} disabled={isPending} className="btn-secondary flex-1">
          Annuler
        </button>
        <button
          type="button"
          disabled={isPending || reason.trim().length < 3}
          onClick={() => {
            if (isPending) return;
            setError(null);
            startTransition(async () => {
              const result = await run(reason);
              if (result?.error) setError(result.error);
              else {
                setOpen(false);
                setReason('');
                router.refresh();
              }
            });
          }}
          className="btn-danger flex-1"
        >
          {isPending ? 'Enregistrement...' : confirmLabel}
        </button>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

// ---------- Proforma ----------

export function ProformaWorkflowActions({
  documentId,
  canSubmit,
  canValidate,
  canAccept,
  canConvert,
  hasSavedSignature = false,
  submitNeedsSignature = false,
}: {
  documentId: string;
  canSubmit: boolean;
  canValidate: boolean;
  canAccept: boolean;
  canConvert: boolean;
  // 0055 : signature enregistrée du valideur connecté (validation en un clic).
  hasSavedSignature?: boolean;
  // Le commercial n'a ni signature enregistrée ni signature à la main : la
  // soumission sera refusée, on l'indique avant.
  submitNeedsSignature?: boolean;
}) {
  const [signing, setSigning] = useState(false);
  if (!canSubmit && !canValidate && !canAccept && !canConvert) return null;
  return (
    <div className="card space-y-2 p-4">
      <p className="field-label">Circuit de validation</p>
      {canSubmit && submitNeedsSignature && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Aucune signature du commercial : enregistrez-la une fois dans{' '}
          <a href="/settings/signature" className="font-medium underline">
            Ma signature
          </a>{' '}
          (insérée automatiquement ensuite), ou signez cette proforma à la main avec « Faire signer ».
        </p>
      )}
      {canSubmit && (
        <ActionButton
          label="Soumettre à validation"
          pendingLabel="Soumission en cours..."
          run={() => submitProforma(documentId)}
        />
      )}
      {canValidate && hasSavedSignature && !signing && (
        <>
          <ActionButton
            label="Valider (signature enregistrée)"
            pendingLabel="Validation en cours..."
            run={() => validateProforma(documentId)}
          />
          <button type="button" onClick={() => setSigning(true)} className="btn-ghost w-full text-xs">
            Signer à la main plutôt
          </button>
        </>
      )}
      {canValidate && !hasSavedSignature && !signing && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Enregistrez votre signature dans{' '}
          <a href="/settings/signature" className="font-medium underline">
            Ma signature
          </a>{' '}
          pour valider en un clic. Vous pouvez aussi signer à la main ci-dessous.
        </p>
      )}
      {canValidate &&
        (signing ? (
          <div className="space-y-2">
            <SignaturePad
              documentId={documentId}
              role="n1"
              submitLabel="Signer et valider"
              onDone={() => setSigning(false)}
              onUploaded={async (url) => (await validateProforma(documentId, url))?.error ?? null}
            />
            <button type="button" onClick={() => setSigning(false)} className="btn-ghost w-full">
              Annuler
            </button>
          </div>
        ) : hasSavedSignature ? null : (
          <button type="button" onClick={() => setSigning(true)} className="btn-primary w-full">
            Signer à la main et valider
          </button>
        ))}
      {canValidate && !signing && (
        <ReasonAction
          label="Refuser"
          confirmLabel="Refuser la proforma"
          placeholder="Ex. : remise trop élevée, mauvais modèle..."
          run={(reason) => refuseProforma(documentId, reason)}
        />
      )}
      {canAccept && (
        <ActionButton
          label="Marquer acceptée par le client"
          pendingLabel="Enregistrement..."
          variant="btn-secondary"
          run={() => markProformaAccepted(documentId)}
        />
      )}
      {canConvert && (
        <ActionButton
          label="Convertir en bon de commande"
          pendingLabel="Conversion en cours..."
          run={() => convertDocument(documentId, 'commande')}
        />
      )}
    </div>
  );
}

// ---------- Bon de commande : vérification ADV ----------

const CHECKS = [
  { key: 'client', label: 'Informations du client' },
  { key: 'pieces', label: 'Pièces justificatives' },
  { key: 'banque', label: 'Banque du client' },
  { key: 'montants', label: 'Montants' },
];

export function CommandeCheckActions({ documentId, children }: { documentId: string; children?: ReactNode }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const allChecked = CHECKS.every((c) => checked[c.key]);
  return (
    <div className="card space-y-3 p-4">
      <p className="field-label">Vérification du dossier (ADV)</p>
      {children}
      <div className="space-y-1.5">
        {CHECKS.map((c) => (
          <label key={c.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!checked[c.key]}
              onChange={(e) => setChecked((prev) => ({ ...prev, [c.key]: e.target.checked }))}
            />
            {c.label} vérifiés
          </label>
        ))}
      </div>
      <ActionButton
        label="Conforme"
        pendingLabel="Enregistrement..."
        disabled={!allChecked}
        run={() => checkCommande(documentId, true)}
      />
      {!allChecked && <p className="text-xs text-gray-500">Cochez les quatre points pour déclarer le dossier conforme.</p>}
      <ReasonAction
        label="Non conforme"
        confirmLabel="Renvoyer au commercial"
        placeholder="Ex. : pièce d'identité manquante, banque non renseignée, montant différent de la proforma..."
        run={(reason) => checkCommande(documentId, false, reason)}
      />
    </div>
  );
}

// Bon de commande déjà conforme : l'ADV peut le repasser non conforme pour
// permettre une correction (le document est figé à l'étape conforme).
export function CommandeReopenAction({ documentId }: { documentId: string }) {
  return (
    <div className="card space-y-2 p-4">
      <p className="field-label">Correction nécessaire ?</p>
      <ReasonAction
        label="Déclarer non conforme"
        confirmLabel="Renvoyer au commercial"
        placeholder="Ex. : prix à corriger, client à changer..."
        run={(reason) => checkCommande(documentId, false, reason)}
      />
    </div>
  );
}

export function CommandeResubmitAction({ documentId }: { documentId: string }) {
  return (
    <div className="card space-y-2 p-4">
      <p className="field-label">Dossier corrigé ?</p>
      <ActionButton
        label="Renvoyer en vérification"
        pendingLabel="Envoi en cours..."
        run={() => resubmitCommande(documentId)}
      />
    </div>
  );
}

// ---------- Préparation de la facture (ADV) ----------

export type VehicleSlot = { key: string; productId: string; designation: string };
export type VehicleOption = {
  id: string;
  productId: string;
  model: string;
  vin: string;
  color: string | null;
  engineNumber: string | null;
  ageText: string;
};

export function InvoicePreparation({
  commandeId,
  slots,
  options,
}: {
  commandeId: string;
  slots: VehicleSlot[];
  options: VehicleOption[];
}) {
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const complete = slots.every((s) => !!chosen[s.key]);
  const missingStock = slots.some((s) => !options.some((o) => o.productId === s.productId));
  return (
    <div className="card space-y-3 p-4">
      <p className="field-label">Préparer la facture</p>
      {slots.length === 0 && (
        <p className="text-sm text-gray-600">Aucun véhicule sur ce bon de commande : la facture reprend simplement ses lignes.</p>
      )}
      {slots.map((slot, index) => {
        const selected = options.find((o) => o.id === chosen[slot.key]);
        const taken = new Set(Object.entries(chosen).filter(([k]) => k !== slot.key).map(([, v]) => v));
        const list = options.filter((o) => o.productId === slot.productId && !taken.has(o.id));
        return (
          <div key={slot.key} className="space-y-1.5 rounded-md border border-gray-200 p-3">
            <p className="text-sm font-medium">
              Véhicule {index + 1} : {slot.designation.split('\n')[0]}
            </p>
            <label className="block">
              <span className="field-label">Numéro de châssis (véhicules disponibles du modèle)</span>
              <select
                className="input"
                value={chosen[slot.key] ?? ''}
                onChange={(e) => setChosen((prev) => ({ ...prev, [slot.key]: e.target.value }))}
              >
                <option value="">Choisir un châssis</option>
                {list.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.vin}
                    {o.color ? ` | ${o.color}` : ''}
                    {o.engineNumber ? ` | moteur ${o.engineNumber}` : ''} | {o.ageText}
                  </option>
                ))}
              </select>
            </label>
            {list.length === 0 && !selected && (
              <p className="text-xs text-red-700">Aucun véhicule disponible de ce modèle en stock.</p>
            )}
            {selected && (
              <dl className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-gray-500">Modèle</dt>
                  <dd className="font-medium">{selected.model}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Couleur</dt>
                  <dd className="font-medium">{selected.color ?? 'Non renseignée'}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">N° moteur</dt>
                  <dd className="font-medium">{selected.engineNumber ?? 'Non renseigné'}</dd>
                </div>
              </dl>
            )}
          </div>
        );
      })}
      {missingStock && (
        <p className="text-xs text-gray-500">Ajoutez le véhicule au stock (page Véhicules) pour pouvoir le choisir.</p>
      )}
      <ActionButton
        label="Envoyer à la direction pour validation"
        pendingLabel="Préparation en cours..."
        disabled={!complete}
        run={() => prepareInvoice(commandeId, slots.map((s) => chosen[s.key]))}
      />
    </div>
  );
}

// ---------- Validation direction et émission ----------

export function InvoiceValidationActions({ commandeId }: { commandeId: string }) {
  return (
    <div className="card space-y-2 p-4">
      <p className="field-label">Facture en attente de votre validation</p>
      <ActionButton label="Valider la facture" pendingLabel="Validation en cours..." run={() => validateInvoice(commandeId)} />
      <ReasonAction
        label="Refuser"
        confirmLabel="Refuser la facture"
        placeholder="Ex. : mauvais châssis, prix à revoir..."
        run={(reason) => refuseInvoice(commandeId, reason)}
      />
    </div>
  );
}

export function IssueInvoiceAction({ commandeId }: { commandeId: string }) {
  return (
    <div className="card space-y-2 p-4">
      <p className="field-label">Facture validée par la direction</p>
      <ActionButton
        label="Émettre la facture définitive"
        pendingLabel="Émission en cours..."
        run={() => issueFinalInvoice(commandeId)}
      />
      <p className="text-xs text-gray-500">
        Le numéro de facture est attribué à cette étape et le véhicule passe au statut vendu.
      </p>
    </div>
  );
}
