'use client';

import { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

type Role = 'commercial' | 'client';

export function SignaturePad({
  documentId,
  role,
  onDone,
}: {
  documentId: string;
  role: Role;
  onDone: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = getPos(e);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1B2A4A';
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  }

  function end() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  async function validate() {
    setError(null);
    if (!hasDrawn) {
      setError('Signez dans la zone avant de valider.');
      return;
    }
    setSaving(true);
    try {
      const canvas = canvasRef.current!;
      const blob: Blob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/png')
      );
      const path = `${documentId}/${role}-${Date.now()}.png`;

      const { error: uploadError } = await supabase.storage
        .from('document-signatures')
        .upload(path, blob, { contentType: 'image/png' });
      if (uploadError) throw new Error(uploadError.message);

      const { data: publicUrlData } = supabase.storage
        .from('document-signatures')
        .getPublicUrl(path);

      const updatePayload =
        role === 'commercial'
          ? { commercial_signature_url: publicUrlData.publicUrl }
          : {
              client_signature_url: publicUrlData.publicUrl,
              status: 'envoye',
              signed_at: new Date().toISOString(),
            };

      const { error: updateError } = await supabase
        .from('documents')
        .update(updatePayload)
        .eq('id', documentId);
      if (updateError) throw new Error(updateError.message);

      onDone();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la sauvegarde de la signature');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-lg border p-3 space-y-2">
      <p className="text-sm font-medium">
        {role === 'commercial' ? 'Signature du commercial' : 'Signature du client'}
      </p>
      <canvas
        ref={canvasRef}
        width={600}
        height={200}
        className="w-full border rounded-md touch-none bg-gray-50"
        style={{ aspectRatio: '3 / 1' }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={clear} className="flex-1 border rounded-md py-2 text-sm">
          Effacer
        </button>
        <button
          onClick={validate}
          disabled={saving}
          className="flex-1 bg-kf-navy text-white rounded-md py-2 text-sm"
        >
          {saving ? 'Enregistrement...' : 'Valider'}
        </button>
      </div>
    </div>
  );
}
