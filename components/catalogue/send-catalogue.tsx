'use client';

import { useMemo, useState, useTransition } from 'react';
import { sendCatalogue, type CatalogueChoice } from '@/lib/catalogue/actions';
import { formatCFA } from '@/lib/documents/calculations';

type Defaults = {
  clientId?: string | null;
  prospectId?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
};

function endOfMonth() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`;
}

function defaultMessage(name: string, models: CatalogueChoice[]) {
  const hello = name.trim() ? `Bonjour ${name.trim()},` : 'Bonjour,';
  if (models.length === 1) return `${hello}\nVoici la fiche du ${models[0].designation}, avec photos et caractéristiques.`;
  return `${hello}\nVoici notre catalogue avec les modèles qui peuvent vous intéresser, photos et caractéristiques.`;
}

export function SendCatalogueButton({
  choices,
  defaults = {},
  preselected = [],
  label = 'Envoyer un catalogue',
  variant = 'primary',
  block = false,
}: {
  choices: CatalogueChoice[];
  defaults?: Defaults;
  preselected?: string[];
  label?: string;
  variant?: 'primary' | 'secondary';
  block?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${variant === 'primary' ? 'btn-primary' : 'btn-secondary'} w-full justify-center ${block ? '' : 'sm:w-auto'}`}
      >
        {label}
      </button>
      {open && <SendCatalogueDialog choices={choices} defaults={defaults} preselected={preselected} onClose={() => setOpen(false)} />}
    </>
  );
}

function SendCatalogueDialog({
  choices,
  defaults,
  preselected,
  onClose,
}: {
  choices: CatalogueChoice[];
  defaults: Defaults;
  preselected: string[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(preselected.filter((id) => choices.some((c) => c.id === id)));
  const [name, setName] = useState(defaults.name ?? '');
  const [phone, setPhone] = useState(defaults.phone ?? '');
  const [email, setEmail] = useState(defaults.email ?? '');
  const [showPrices, setShowPrices] = useState(true);
  const [until, setUntil] = useState(endOfMonth());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ url: string; channel: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const chosen = useMemo(() => choices.filter((c) => selected.includes(c.id)), [choices, selected]);
  const text = message ?? defaultMessage(name, chosen);
  const previewHref =
    selected.length > 0
      ? `/api/catalogue/pdf?models=${selected.join(',')}${showPrices ? `&prices=1&until=${until}` : ''}&name=${encodeURIComponent(name)}`
      : null;

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function send(channel: 'whatsapp' | 'email' | 'lien') {
    if (isPending) return;
    setError(null);
    setCopied(false);
    // Fenêtre ouverte tout de suite (sinon bloquée par le navigateur après
    // l'attente du serveur), puis dirigée vers WhatsApp ou Gmail.
    const popup = channel === 'lien' ? null : window.open('', '_blank');
    startTransition(async () => {
      const result = await sendCatalogue({
        productIds: selected,
        kind: selected.length === 1 ? 'fiche' : 'gamme',
        showPrices,
        pricesValidUntil: showPrices ? until : null,
        channel,
        clientId: defaults.clientId ?? null,
        prospectId: defaults.prospectId ?? null,
        recipientName: name,
        recipientPhone: phone,
        recipientEmail: email,
        message: text,
      });
      if ('error' in result) {
        popup?.close();
        setError(result.error);
        return;
      }
      if (result.openUrl && popup) popup.location.href = result.openUrl;
      else if (result.openUrl) window.location.href = result.openUrl;
      if (channel === 'lien') {
        try {
          await navigator.clipboard.writeText(result.copyText);
          setCopied(true);
        } catch {
          // copie refusée par le navigateur : le lien reste affiché
        }
      }
      setDone({ url: result.url, channel });
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-nuit/50 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[100dvh] w-full flex-col bg-white sm:max-h-[90vh] sm:max-w-2xl sm:rounded-md sm:border sm:border-gray-200">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <p className="text-base font-semibold text-gray-900">Envoyer un catalogue</p>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100">
            Fermer
          </button>
        </div>

        {done ? (
          <div className="space-y-4 p-4">
            <p className="text-sm text-gray-800">
              {done.channel === 'whatsapp'
                ? 'WhatsApp est ouvert avec le message prêt : il ne reste qu’à appuyer sur Envoyer.'
                : done.channel === 'email'
                ? 'Gmail est ouvert avec le message prêt : vérifiez puis envoyez.'
                : copied
                ? 'Message et lien copiés : collez-les dans la conversation de votre choix.'
                : 'Lien créé : copiez-le ci-dessous.'}
            </p>
            <div className="rounded-md border border-gray-200 bg-[#F7F8FA] p-3">
              <p className="text-xs text-gray-500">Lien du catalogue (valable 30 jours)</p>
              <p className="mt-1 break-all text-sm font-medium text-gray-900">{done.url}</p>
            </div>
            <p className="text-xs text-gray-500">L’envoi est enregistré dans l’historique ; vous serez prévenu à la première ouverture.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(done.url);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
                className="btn-secondary flex-1 justify-center"
              >
                {copied ? 'Lien copié' : 'Copier le lien'}
              </button>
              <button type="button" onClick={onClose} className="btn-primary flex-1 justify-center">
                Terminé
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-900">
                    Modèles <span className="font-normal text-gray-500">({selected.length} choisi{selected.length > 1 ? 's' : ''})</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setSelected(selected.length === choices.length ? [] : choices.map((c) => c.id))}
                    className="btn-link"
                  >
                    {selected.length === choices.length ? 'Tout retirer' : 'Tout choisir'}
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {choices.map((c) => {
                    const on = selected.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-md border p-2 ${
                          on ? 'border-kf-navy bg-kf-navy/5' : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <input type="checkbox" checked={on} onChange={() => toggle(c.id)} className="h-4 w-4 accent-kf-navy" />
                        {c.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.photoUrl} alt="" className="h-10 w-14 shrink-0 rounded-sm bg-[#F7F8FA] object-contain" />
                        ) : (
                          <span className="h-10 w-14 shrink-0 rounded-sm bg-[#F7F8FA]" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-gray-900">{c.designation}</span>
                          <span className="block text-xs tabular-nums text-gray-500">{formatCFA(c.salePrice)}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {selected.length <= 1
                    ? 'Un modèle : fiche modèle sur 2 pages.'
                    : 'Plusieurs modèles : catalogue avec couverture, sommaire, une page par modèle et contacts.'}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="field-label">Destinataire</span>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom" />
                </label>
                <label className="block">
                  <span className="field-label">WhatsApp</span>
                  <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+228 ..." inputMode="tel" />
                </label>
                <label className="block">
                  <span className="field-label">E-mail</span>
                  <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nom@exemple.com" inputMode="email" />
                </label>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-800">
                  <input type="checkbox" checked={showPrices} onChange={(e) => setShowPrices(e.target.checked)} className="h-4 w-4 accent-kf-navy" />
                  Afficher les prix
                </label>
                {showPrices && (
                  <label className="block">
                    <span className="field-label">Prix valables jusqu&apos;au</span>
                    <input type="date" className="input" value={until} onChange={(e) => setUntil(e.target.value)} />
                  </label>
                )}
              </div>

              <label className="block">
                <span className="field-label">Message</span>
                <textarea className="input min-h-[84px]" value={text} onChange={(e) => setMessage(e.target.value)} />
                <span className="mt-1 block text-xs text-gray-500">Le lien du catalogue et vos coordonnées sont ajoutés automatiquement.</span>
              </label>

              {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            </div>

            <div className="flex flex-col gap-2 border-t border-gray-200 p-4 sm:flex-row sm:items-center">
              {previewHref ? (
                <a href={previewHref} target="_blank" rel="noopener" className="btn-secondary justify-center">
                  Aperçu PDF
                </a>
              ) : (
                <span className="btn-secondary pointer-events-none justify-center opacity-50">Aperçu PDF</span>
              )}
              <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:justify-end">
                <button type="button" disabled={isPending || selected.length === 0} onClick={() => send('lien')} className="btn-secondary justify-center">
                  Copier le lien
                </button>
                <button type="button" disabled={isPending || selected.length === 0} onClick={() => send('email')} className="btn-secondary justify-center">
                  Gmail
                </button>
                <button type="button" disabled={isPending || selected.length === 0} onClick={() => send('whatsapp')} className="btn-primary justify-center">
                  {isPending ? 'Préparation...' : 'WhatsApp'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
