'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';

// Copie adaptée de components/documents/signature-pad.tsx pour la fiche
// SAV : la zone ne fait que dessiner ; l'envoi et l'enregistrement sont
// faits par le formulaire, en une seule opération avec le reste de la fiche.
// Les coordonnées sont ramenées à la taille interne du canvas (sinon le
// trait est décalé dès que la zone affichée n'a pas 600 px de large).

export interface InspectionSignaturePadHandle {
  isEmpty: () => boolean;
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
}

export const InspectionSignaturePad = forwardRef<InspectionSignaturePadHandle, { disabled?: boolean; onChange?: (hasDrawn: boolean) => void }>(
  function InspectionSignaturePad({ disabled = false, onChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const [hasDrawn, setHasDrawn] = useState(false);

    function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) * canvas.width) / rect.width,
        y: ((e.clientY - rect.top) * canvas.height) / rect.height,
      };
    }

    function start(e: React.PointerEvent<HTMLCanvasElement>) {
      if (disabled) return;
      drawing.current = true;
      canvasRef.current!.setPointerCapture?.(e.pointerId);
      const ctx = canvasRef.current!.getContext('2d')!;
      const { x, y } = getPos(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
    }

    function move(e: React.PointerEvent<HTMLCanvasElement>) {
      if (!drawing.current || disabled) return;
      const ctx = canvasRef.current!.getContext('2d')!;
      const { x, y } = getPos(e);
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1B2A4A';
      ctx.lineTo(x, y);
      ctx.stroke();
      if (!hasDrawn) {
        setHasDrawn(true);
        onChange?.(true);
      }
    }

    function end() {
      drawing.current = false;
    }

    function clear() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
      setHasDrawn(false);
      onChange?.(false);
    }

    useImperativeHandle(ref, () => ({
      isEmpty: () => !hasDrawn,
      clear,
      toBlob: () =>
        new Promise<Blob | null>((resolve) => {
          const canvas = canvasRef.current;
          if (!canvas || !hasDrawn) return resolve(null);
          canvas.toBlob((b) => resolve(b), 'image/png');
        }),
    }));

    return (
      <div className="space-y-2">
        <canvas
          ref={canvasRef}
          width={900}
          height={300}
          className="w-full border border-trait rounded-md touch-none bg-papier"
          style={{ aspectRatio: '3 / 1' }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-encre-3">{hasDrawn ? 'Signature saisie.' : 'Le client signe dans le cadre ci-dessus.'}</p>
          <button type="button" onClick={clear} disabled={disabled} className="btn-secondary btn-sm">
            Effacer
          </button>
        </div>
      </div>
    );
  }
);
