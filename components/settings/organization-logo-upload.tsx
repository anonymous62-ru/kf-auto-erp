'use client';

import { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { updateOrganizationLogo } from '@/lib/organization/actions';
import { IconCheck, IconX } from '@/components/icons';

const MAX_SIZE_MB = 2;
const ACCEPTED = ['image/png', 'image/jpeg'];

export function OrganizationLogoUpload({
  organizationId,
  currentLogoUrl,
  organizationName,
}: {
  organizationId: string;
  currentLogoUrl: string | null;
  organizationName: string;
}) {
  const [logoUrl, setLogoUrl] = useState(currentLogoUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    setSuccess(false);

    if (!ACCEPTED.includes(file.type)) {
      setError('Format non supporté : utilisez une image PNG ou JPG.');
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`Le fichier dépasse ${MAX_SIZE_MB} Mo.`);
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const ext = file.type === 'image/png' ? 'png' : 'jpg';
      // Nom de fichier fixe (pas de suffixe aléatoire) : chaque nouvel envoi
      // remplace le précédent (upsert), au lieu d'accumuler des fichiers
      // orphelins dans le bucket.
      const path = `${organizationId}/logo.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('logos')
        .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from('logos').getPublicUrl(path);
      // On force un paramètre de cache-busting : le navigateur (et les PDF
      // déjà générés) ne doivent pas continuer à afficher l'ancien logo mis
      // en cache sous la même URL après un remplacement.
      const bustedUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

      await updateOrganizationLogo(organizationId, bustedUrl);
      setLogoUrl(bustedUrl);
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'envoi du logo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      await updateOrganizationLogo(organizationId, null);
      setLogoUrl(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec de la suppression.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-kf-navy">Logo de l'organisation</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Affiché en haut et en pied de page des documents (PDF/Word), ainsi que dans l'application.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className="h-16 w-16 rounded-xl border border-gray-200 bg-white flex items-center justify-center overflow-hidden shrink-0">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={organizationName} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-kf-navy font-bold text-sm">
              {organizationName
                .split(' ')
                .map((w) => w[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </span>
          )}
        </div>

        <div className="flex-1 space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {logoUrl ? 'Remplacer le logo' : 'Ajouter un logo'}
            </button>
            {logoUrl && (
              <button type="button" className="btn-danger-ghost" disabled={busy} onClick={handleRemove}>
                Retirer
              </button>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
          />
          <p className="text-[11px] text-gray-400">PNG ou JPG, 2 Mo maximum. Idéalement sur fond transparent.</p>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1">
          <IconX className="w-3.5 h-3.5" /> {error}
        </p>
      )}
      {success && (
        <p className="text-xs text-green-600 flex items-center gap-1">
          <IconCheck className="w-3.5 h-3.5" /> Logo mis à jour.
        </p>
      )}
    </div>
  );
}
