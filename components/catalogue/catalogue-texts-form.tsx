'use client';

import { useState, useTransition } from 'react';
import { saveCatalogueTexts, type CatalogueTexts } from '@/lib/catalogue/actions';

// Textes commerciaux du catalogue. La fiche technique, elle, vient de la
// description du produit (sections en MAJUSCULES + puces).
export function CatalogueTextsForm({ productId, initial, canEdit }: { productId: string; initial: CatalogueTexts; canEdit: boolean }) {
  const [texts, setTexts] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const set = (key: keyof CatalogueTexts) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSaved(false);
    setTexts({ ...texts, [key]: e.target.value });
  };

  if (!canEdit) {
    const empty = !texts.tagline && !texts.highlights && !texts.equipment && !texts.colors;
    return (
      <section className="card space-y-2 p-4 text-sm">
        <p className="font-semibold text-gray-900">Textes du catalogue</p>
        {empty ? (
          <p className="text-gray-500">Pas encore de texte commercial : la fiche reprend la description technique.</p>
        ) : (
          <>
            {texts.tagline && <p className="text-gray-700">{texts.tagline}</p>}
            {texts.highlights && <p className="whitespace-pre-line text-gray-600">{texts.highlights}</p>}
          </>
        )}
      </section>
    );
  }

  return (
    <section className="card space-y-3 p-4">
      <div>
        <p className="text-sm font-semibold text-gray-900">Textes du catalogue</p>
        <p className="text-xs text-gray-500">
          Imprimés sur la fiche modèle et le catalogue. La fiche technique reprend la description du produit.
        </p>
      </div>
      <label className="block">
        <span className="field-label">Accroche (une phrase)</span>
        <input className="input" value={texts.tagline} onChange={set('tagline')} maxLength={160} placeholder="Ex. : SUV familial 7 places, moteur turbo et boîte automatique" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">Points forts (un par ligne)</span>
          <textarea className="input min-h-[120px]" value={texts.highlights} onChange={set('highlights')} />
        </label>
        <label className="block">
          <span className="field-label">Équipements (un par ligne)</span>
          <textarea className="input min-h-[120px]" value={texts.equipment} onChange={set('equipment')} />
        </label>
      </div>
      <label className="block">
        <span className="field-label">Couleurs disponibles</span>
        <input className="input" value={texts.colors} onChange={set('colors')} placeholder="Ex. : Blanc, Gris, Noir" />
      </label>
      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-xs text-emerald-700">Enregistré</span>}
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await saveCatalogueTexts(productId, texts);
              if (result.error) setError(result.error);
              else setSaved(true);
            })
          }
          className="btn-primary"
        >
          {isPending ? 'Enregistrement...' : 'Enregistrer les textes'}
        </button>
      </div>
    </section>
  );
}
