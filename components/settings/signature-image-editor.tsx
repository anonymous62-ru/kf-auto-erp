'use client';

// Enregistrement d'une signature (dessin ou image importée) ou d'un cachet
// (image importée). L'image est préparée dans le navigateur avant l'envoi :
// fond blanc rendu transparent (pour que la signature se pose sur le cachet
// et le papier), recadrage au plus près, réduction de taille, export PNG.

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SignaturePad } from '@/components/documents/signature-pad';
import {
  removeOrganizationStamp,
  removeSignature,
  saveOrganizationStamp,
  saveSignature,
  type StampKind,
} from '@/lib/signatures/actions';

const ACCEPTED = ['image/png', 'image/jpeg'];
const MAX_INPUT_MB = 8;

type Target = { type: 'signature'; userId?: string } | { type: 'stamp'; kind: StampKind };

async function prepareImage(source: Blob, maxW: number, maxH: number): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, maxW / bitmap.width, maxH / bitmap.height);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const light = Math.min(px[i], px[i + 1], px[i + 2]);
      // Blanc et quasi-blanc (papier scanné) : transparent, avec un fondu
      // entre 200 et 240 pour garder des bords propres.
      if (light >= 240) px[i + 3] = 0;
      else if (light > 200) px[i + 3] = Math.round(px[i + 3] * ((240 - light) / 40));
      if (px[i + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("L'image est vide (aucun trait visible).");
  ctx.putImageData(img, 0, 0);
  const pad = 4;
  const cx = Math.max(0, minX - pad);
  const cy = Math.max(0, minY - pad);
  const cw = Math.min(w, maxX + pad + 1) - cx;
  const ch = Math.min(h, maxY + pad + 1) - cy;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  out.getContext('2d')!.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
  return new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("Conversion de l'image impossible."))), 'image/png')
  );
}

export function SignatureImageEditor({
  target,
  title,
  description,
  currentUrl,
  allowDraw = true,
}: {
  target: Target;
  title: string;
  description?: string;
  currentUrl: string | null;
  allowDraw?: boolean;
}) {
  const [mode, setMode] = useState<'view' | 'draw'>('view');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const isStamp = target.type === 'stamp';

  async function send(blob: Blob): Promise<string | null> {
    const prepared = await prepareImage(blob, isStamp ? 500 : 800, isStamp ? 500 : 300);
    const fd = new FormData();
    fd.append('file', prepared, 'image.png');
    let result;
    if (target.type === 'stamp') {
      fd.append('kind', target.kind);
      result = await saveOrganizationStamp(fd);
    } else {
      if (target.userId) fd.append('userId', target.userId);
      result = await saveSignature(fd);
    }
    return result?.error ?? null;
  }

  function onFile(file: File | undefined) {
    setError(null);
    setSuccess(null);
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      setError('Format non supporté : utilisez une image PNG ou JPG.');
      return;
    }
    if (file.size > MAX_INPUT_MB * 1024 * 1024) {
      setError(`Le fichier dépasse ${MAX_INPUT_MB} Mo.`);
      return;
    }
    startTransition(async () => {
      try {
        const failure = await send(file);
        if (failure) setError(failure);
        else {
          setSuccess(isStamp ? 'Cachet enregistré.' : 'Signature enregistrée.');
          router.refresh();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "L'envoi a échoué.");
      } finally {
        if (inputRef.current) inputRef.current.value = '';
      }
    });
  }

  function onRemove() {
    if (isPending) return;
    if (!window.confirm(isStamp ? 'Retirer ce cachet ?' : 'Retirer cette signature ?')) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result =
        target.type === 'stamp' ? await removeOrganizationStamp(target.kind) : await removeSignature(target.userId);
      if (result?.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="card space-y-3 p-4">
      <div>
        <p className="section-title">{title}</p>
        {description && <p className="text-xs text-gray-500">{description}</p>}
      </div>

      {mode === 'draw' ? (
        <div className="space-y-2">
          <SignaturePad
            documentId="signature"
            role="commercial"
            title="Dessinez la signature au doigt ou à la souris"
            submitLabel="Enregistrer"
            onDone={() => {
              setMode('view');
              setSuccess('Signature enregistrée.');
            }}
            onCapture={send}
          />
          <button type="button" onClick={() => setMode('view')} className="btn-ghost w-full">
            Annuler
          </button>
        </div>
      ) : (
        <>
          <div
            className={`flex items-center justify-center rounded-md border border-dashed border-gray-300 bg-white p-3 ${
              isStamp ? 'h-36' : 'h-28'
            }`}
          >
            {currentUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={currentUrl} alt={title} className="max-h-full max-w-full object-contain" />
            ) : (
              <p className="text-xs text-gray-400">{isStamp ? 'Aucun cachet enregistré' : 'Aucune signature enregistrée'}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {allowDraw && !isStamp && (
              <button type="button" disabled={isPending} onClick={() => setMode('draw')} className="btn-primary">
                {currentUrl ? 'Redessiner' : target.type === 'signature' && target.userId ? 'Dessiner la signature' : 'Dessiner ma signature'}
              </button>
            )}
            <button
              type="button"
              disabled={isPending}
              onClick={() => inputRef.current?.click()}
              className={isStamp ? 'btn-primary' : 'btn-secondary'}
            >
              {isPending ? 'Envoi en cours...' : currentUrl ? 'Remplacer par une image' : 'Importer une image'}
            </button>
            {currentUrl && (
              <button type="button" disabled={isPending} onClick={onRemove} className="btn-ghost text-red-700">
                Retirer
              </button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </div>
          <p className="text-xs text-gray-500">
            PNG ou JPG, fond transparent ou blanc (le blanc est retiré automatiquement).
          </p>
        </>
      )}
      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {success && <p className="text-sm text-green-700">{success}</p>}
    </div>
  );
}
