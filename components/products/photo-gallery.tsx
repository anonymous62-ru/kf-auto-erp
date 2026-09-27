'use client';

import { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { addProductPhoto, deleteProductPhoto, getCurrentOrganizationId } from '@/lib/products/gallery-actions';
import { IconCamera, IconX } from '@/components/icons';

const MAX_SIZE_MB = 5;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

type Photo = { id: string; url: string; storage_path: string };

export function PhotoGallery({ productId, initialPhotos }: { productId: string; initialPhotos: Photo[] }) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(fileList: FileList) {
    // Important : on convertit tout de suite en tableau "figé". `fileList`
    // est l'objet FileList lié en direct au <input> — dès que l'appelant
    // remet `input.value = ''` (juste après avoir déclenché cette fonction,
    // pour pouvoir resélectionner les mêmes fichiers plus tard), ce même
    // objet se retrouve vidé. Comme cette fonction est async et ne lit la
    // liste qu'après un premier `await`, elle la découvrait déjà vide : les
    // photos ne partaient jamais, sans la moindre erreur (le "traitement en
    // cours" tournait pour rien).
    const files = Array.from(fileList);
    setError(null);
    setBusy(true);
    try {
      const organizationId = await getCurrentOrganizationId();
      const supabase = createClient();

      for (const file of files) {
        if (!ACCEPTED.includes(file.type)) {
          setError('Format non supporté : utilisez une image PNG, JPG ou WEBP.');
          continue;
        }
        if (file.size > MAX_SIZE_MB * 1024 * 1024) {
          setError(`Une photo dépasse ${MAX_SIZE_MB} Mo et a été ignorée.`);
          continue;
        }

        const ext = file.name.split('.').pop() || 'jpg';
        const path = `${organizationId}/${productId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('vehicle-photos')
          .upload(path, file, { contentType: file.type, cacheControl: '3600' });
        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage.from('vehicle-photos').getPublicUrl(path);

        const created = await addProductPhoto({ productId, storagePath: path, url: publicUrlData.publicUrl });
        setPhotos((prev) => [...prev, { id: created.id, url: publicUrlData.publicUrl, storage_path: path }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'envoi.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(photoId: string) {
    setError(null);
    setBusy(true);
    try {
      await deleteProductPhoto(photoId);
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-kf-navy">Photos du véhicule</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
        >
          <IconCamera className="w-3.5 h-3.5" /> Ajouter
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {photos.length === 0 ? (
        <p className="text-xs text-gray-400">Aucune photo pour l'instant.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <div key={photo.id} className="relative aspect-square rounded-lg overflow-hidden border border-gray-200 group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="Photo du véhicule" className="w-full h-full object-cover" />
              <button
                type="button"
                disabled={busy}
                onClick={() => handleDelete(photo.id)}
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Supprimer"
              >
                <IconX className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
      {busy && <p className="text-xs text-gray-400">Traitement en cours...</p>}
    </div>
  );
}
