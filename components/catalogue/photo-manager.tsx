'use client';

import { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  getOrganizationIdForUpload,
  registerUploadedPhoto,
  removeCataloguePhoto,
  savePhotoOrder,
  setPhotoKind,
  type CataloguePhoto,
} from '@/lib/catalogue/actions';
import { PHOTO_KINDS } from '@/lib/catalogue/roles';

const MAX_INPUT_MB = 15;
const MAX_WIDTH = 1800;

// Redimensionne dans le navigateur et convertit en JPEG (le PDF n'accepte
// que JPEG et PNG ; une photo de téléphone de 8 Mo devient ~400 Ko).
async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Conversion impossible sur cet appareil.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversion impossible.'))), 'image/jpeg', 0.86)
  );
}

export function PhotoManager({
  productId,
  initialPhotos,
  canEdit,
}: {
  productId: string;
  initialPhotos: CataloguePhoto[];
  canEdit: boolean;
}) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [kind, setKind] = useState('exterieur');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function persist(next: CataloguePhoto[], mainId: string | null) {
    const previous = photos;
    setPhotos(next.map((p, i) => ({ ...p, position: i, is_main: p.id === mainId })));
    const result = await savePhotoOrder(productId, next.map((p) => p.id), mainId);
    if (result.error) {
      setPhotos(previous);
      setError(result.error);
    }
  }

  const mainId = photos.find((p) => p.is_main)?.id ?? photos[0]?.id ?? null;

  function move(id: string, delta: number) {
    const index = photos.findIndex((p) => p.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= photos.length) return;
    const next = [...photos];
    [next[index], next[target]] = [next[target], next[index]];
    void persist(next, mainId);
  }

  function dropOn(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const next = photos.filter((p) => p.id !== dragId);
    const dragged = photos.find((p) => p.id === dragId);
    const targetIndex = next.findIndex((p) => p.id === targetId);
    if (!dragged || targetIndex < 0) return;
    next.splice(targetIndex, 0, dragged);
    setDragId(null);
    void persist(next, mainId);
  }

  async function upload(fileList: FileList) {
    const files = Array.from(fileList);
    setError(null);
    setBusy('Envoi des photos...');
    try {
      const organizationId = await getOrganizationIdForUpload();
      if (!organizationId) throw new Error("Seules l'administration et la chargée marketing ajoutent des photos.");
      const supabase = createClient();
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          setError('Seules les images sont acceptées.');
          continue;
        }
        if (file.size > MAX_INPUT_MB * 1024 * 1024) {
          setError(`Une photo dépasse ${MAX_INPUT_MB} Mo et a été ignorée.`);
          continue;
        }
        const blob = await toJpeg(file);
        const path = `${organizationId}/${productId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const { error: upErr } = await supabase.storage
          .from('vehicules')
          .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
        if (upErr) throw new Error(upErr.message);
        const url = supabase.storage.from('vehicules').getPublicUrl(path).data.publicUrl;
        const result = await registerUploadedPhoto({ productId, storagePath: path, url, kind });
        if (result.error || !result.photo) throw new Error(result.error ?? "La photo n'a pas pu être enregistrée.");
        setPhotos((prev) => [...prev, result.photo!]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'envoi.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Retirer cette photo du catalogue ?')) return;
    setError(null);
    setBusy('Suppression...');
    const result = await removeCataloguePhoto(id);
    setBusy(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setPhotos((prev) => {
      const rest = prev.filter((p) => p.id !== id);
      if (rest.length > 0 && !rest.some((p) => p.is_main)) rest[0] = { ...rest[0], is_main: true };
      return rest;
    });
  }

  async function changeKind(id: string, value: string) {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, kind: value } : p)));
    const result = await setPhotoKind(id, value);
    if (result.error) setError(result.error);
  }

  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">Photos du catalogue</p>
          <p className="text-xs text-gray-500">
            {canEdit
              ? 'Glissez pour réordonner. La photo principale ouvre la fiche et le catalogue.'
              : 'Photos utilisées dans les fiches et catalogues envoyés aux clients.'}
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <select className="input h-9 w-auto py-1 text-sm" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type des photos ajoutées">
              {Object.entries(PHOTO_KINDS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <button type="button" disabled={!!busy} onClick={() => inputRef.current?.click()} className="btn-primary h-9 py-1">
              Ajouter des photos
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) void upload(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        )}
      </div>

      {photos.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 px-4 py-8 text-center">
          <p className="text-sm font-medium text-gray-700">Aucune photo pour ce modèle</p>
          <p className="mt-1 text-xs text-gray-500">
            {canEdit
              ? 'Ajoutez des photos depuis votre appareil ou importez les photos officielles ci-dessous.'
              : "Les fiches seront envoyées sans photo tant que l'administration n'en a pas ajouté."}
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo, index) => {
            const isMain = photo.id === mainId;
            return (
              <li
                key={photo.id}
                draggable={canEdit}
                onDragStart={() => setDragId(photo.id)}
                onDragOver={(e) => canEdit && e.preventDefault()}
                onDrop={() => dropOn(photo.id)}
                className={`overflow-hidden rounded-md border bg-white ${isMain ? 'border-kf-navy' : 'border-gray-200'} ${
                  dragId === photo.id ? 'opacity-50' : ''
                }`}
              >
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt="" className="aspect-[4/3] w-full bg-[#F7F8FA] object-contain" />
                  {isMain && (
                    <span className="absolute left-2 top-2 rounded-sm bg-kf-navy px-1.5 py-0.5 text-[11px] font-medium text-white">
                      Principale
                    </span>
                  )}
                </div>
                {canEdit ? (
                  <div className="space-y-2 p-2">
                    <select
                      className="input h-8 py-0 text-xs"
                      value={photo.kind}
                      onChange={(e) => void changeKind(photo.id, e.target.value)}
                      aria-label="Type de photo"
                    >
                      {Object.entries(PHOTO_KINDS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center justify-between gap-1 text-xs">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => move(photo.id, -1)}
                          className="rounded-md border border-gray-200 px-2 py-1 text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                          aria-label="Avancer"
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          disabled={index === photos.length - 1}
                          onClick={() => move(photo.id, 1)}
                          className="rounded-md border border-gray-200 px-2 py-1 text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                          aria-label="Reculer"
                        >
                          →
                        </button>
                      </div>
                      {!isMain && (
                        <button type="button" onClick={() => void persist(photos, photo.id)} className="font-medium text-kf-navy hover:underline">
                          Principale
                        </button>
                      )}
                      <button type="button" onClick={() => void remove(photo.id)} className="font-medium text-red-600 hover:underline">
                        Retirer
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="px-2 py-1.5 text-xs text-gray-500">{PHOTO_KINDS[photo.kind] ?? photo.kind}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {busy && <p className="text-xs text-gray-500">{busy}</p>}
    </section>
  );
}
