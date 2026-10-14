'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { findOfficialImages, importOfficialImages } from '@/lib/catalogue/actions';
import { PHOTO_KINDS } from '@/lib/catalogue/roles';

type Found = { url: string; hint: string };

// Import des photos officielles : on colle l'adresse de la page du modèle sur
// cheryauto.tg ou kfauto.tg, on coche les photos voulues, le serveur les
// télécharge et les range dans le stockage « vehicules ».
export function OfficialPhotoImport({ productId }: { productId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pageUrl, setPageUrl] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [kind, setKind] = useState('exterieur');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary w-full justify-center sm:w-auto">
        Importer les photos officielles (cheryauto.tg, kfauto.tg)
      </button>
    );
  }

  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">Photos officielles</p>
          <p className="text-xs text-gray-500">
            Collez l&apos;adresse de la page du modèle sur cheryauto.tg ou kfauto.tg, puis cochez les photos à importer.
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-500 hover:text-gray-800">
          Fermer
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="input flex-1"
          value={pageUrl}
          onChange={(e) => setPageUrl(e.target.value)}
          placeholder="https://cheryauto.tg/..."
          inputMode="url"
        />
        <button
          type="button"
          disabled={isPending || !pageUrl.trim()}
          onClick={() => {
            setError(null);
            setMessage(null);
            startTransition(async () => {
              const result = await findOfficialImages(pageUrl);
              if (result.error) {
                setError(result.error);
                setFound([]);
              } else {
                setFound(result.images ?? []);
                setSelected([]);
              }
            });
          }}
          className="btn-primary justify-center"
        >
          {isPending && found.length === 0 ? 'Lecture de la page...' : 'Chercher les photos'}
        </button>
      </div>

      {found.length > 0 && (
        <>
          <p className="text-xs text-gray-500">
            {found.length} image{found.length > 1 ? 's' : ''} trouvée{found.length > 1 ? 's' : ''} ; cochez celles du modèle (12 au plus).
          </p>
          <ul className="grid max-h-[420px] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
            {found.map((img) => {
              const on = selected.includes(img.url);
              return (
                <li key={img.url}>
                  <label className={`block cursor-pointer overflow-hidden rounded-md border ${on ? 'border-kf-navy ring-1 ring-kf-navy' : 'border-gray-200'}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={img.hint} loading="lazy" referrerPolicy="no-referrer" className="aspect-[4/3] w-full bg-[#F7F8FA] object-contain" />
                    <span className="flex items-center gap-2 px-2 py-1.5 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setSelected((prev) => (prev.includes(img.url) ? prev.filter((u) => u !== img.url) : [...prev, img.url].slice(0, 12)))
                        }
                        className="h-3.5 w-3.5 accent-kf-navy"
                      />
                      <span className="truncate">{img.hint || 'Photo'}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <select className="input h-10 w-full sm:w-auto" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type des photos importées">
              {Object.entries(PHOTO_KINDS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={isPending || selected.length === 0}
              onClick={() => {
                setError(null);
                setMessage(null);
                startTransition(async () => {
                  const result = await importOfficialImages({ productId, imageUrls: selected, kind });
                  if (result.error) {
                    setError(result.error);
                    return;
                  }
                  const n = result.photos?.length ?? 0;
                  setMessage(
                    `${n} photo${n > 1 ? 's' : ''} importée${n > 1 ? 's' : ''}` +
                      (result.failed ? `, ${result.failed} refusée${result.failed > 1 ? 's' : ''} (format ou taille).` : '.')
                  );
                  setSelected([]);
                  router.refresh();
                });
              }}
              className="btn-primary justify-center"
            >
              {isPending && selected.length > 0 ? 'Import en cours...' : `Importer ${selected.length || ''} photo${selected.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </>
      )}

      {message && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}
