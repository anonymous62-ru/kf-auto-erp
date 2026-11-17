'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { saveInspection } from '@/lib/atelier/inspection-actions';
import {
  ACCESSORIES,
  BODY_ZONES,
  DAMAGE_TYPES,
  INSPECTION_BUCKET,
  INSPECTION_KIND_LABELS,
  WARNING_LIGHTS,
  damageLabel,
  formatKm,
  fuelLabel,
  zoneLabel,
  type BodyDamage,
  type InspectionKind,
  type InspectionRow,
} from '@/lib/atelier/inspection-config';
import { FuelGauge } from '@/components/atelier/fuel-gauge';
import { InspectionSignaturePad, type InspectionSignaturePadHandle } from '@/components/atelier/inspection-signature-pad';
import { IconCamera, IconX } from '@/components/icons';

const MAX_PHOTOS = 20;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function toLocalInput(iso: string | null | undefined) {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Réduit la photo (1600 px de côté, JPEG 80 %) avant l'envoi : une photo de
// téléphone passe de 4 à 6 Mo à environ 300 Ko. Si le navigateur ne sait
// pas lire le format (HEIC hors Safari), on envoie le fichier d'origine.
async function compressImage(file: File): Promise<{ blob: Blob; ext: string; type: string }> {
  const fallbackExt = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const max = 1600;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    if (blob && blob.size < file.size) return { blob, ext: 'jpg', type: 'image/jpeg' };
  } catch {
    // format non lisible par le navigateur : envoi tel quel
  }
  return { blob: file, ext: fallbackExt, type: file.type || 'image/jpeg' };
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

interface PhotoItem {
  path: string;
  preview: string | null;
  uploadedNow: boolean;
}

export function InspectionForm({
  repairOrderId,
  organizationId,
  kind,
  initial,
  reception,
  defaultReceptionistName,
  fileUrls,
}: {
  repairOrderId: string;
  organizationId: string;
  kind: InspectionKind;
  initial: InspectionRow | null;
  // À la restitution : fiche d'entrée, pour pré-remplir et rappeler l'état.
  reception: InspectionRow | null;
  defaultReceptionistName: string;
  fileUrls: Record<string, string>;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const prefill = initial ?? null;
  const fromEntry = kind === 'restitution' && !initial ? reception : null;

  const [receptionistName, setReceptionistName] = useState(prefill?.receptionist_name ?? defaultReceptionistName);
  const [inspectedAt, setInspectedAt] = useState(toLocalInput(prefill?.inspected_at));
  const [mileage, setMileage] = useState(prefill?.mileage !== null && prefill?.mileage !== undefined ? String(prefill.mileage) : '');
  const [fuel, setFuel] = useState<number | null>(prefill?.fuel_level ?? null);
  const [bodyOk, setBodyOk] = useState<boolean>(prefill?.checklist.body_ok ?? false);
  const [damages, setDamages] = useState<BodyDamage[]>(
    prefill?.checklist.body_damages ?? fromEntry?.checklist.body_damages ?? []
  );
  const [lights, setLights] = useState<string[]>(prefill?.checklist.warning_lights ?? []);
  const [lightsOther, setLightsOther] = useState(prefill?.checklist.warning_lights_other ?? '');
  const [accessories, setAccessories] = useState<string[]>(
    prefill?.checklist.accessories ?? fromEntry?.checklist.accessories ?? []
  );
  const [accOther, setAccOther] = useState(prefill?.checklist.accessories_other ?? fromEntry?.checklist.accessories_other ?? '');
  const [observations, setObservations] = useState(prefill?.observations ?? '');
  const [photos, setPhotos] = useState<PhotoItem[]>(
    (prefill?.photos ?? []).map((p) => ({ path: p, preview: fileUrls[p] ?? null, uploadedNow: false }))
  );
  const [signerName, setSignerName] = useState(prefill?.client_signer_name ?? reception?.client_signer_name ?? '');
  const [hasSignature, setHasSignature] = useState(false);

  const [newZone, setNewZone] = useState<string>(BODY_ZONES[0].key);
  const [newType, setNewType] = useState<string>(DAMAGE_TYPES[0].key);
  const [newComment, setNewComment] = useState('');

  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState<null | 'draft' | 'sign'>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const padRef = useRef<InspectionSignaturePadHandle>(null);

  const disabled = busy !== null;
  const entryKm = reception?.mileage ?? null;

  function toggle(list: string[], setList: (v: string[]) => void, key: string) {
    setList(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  }

  function addDamage() {
    setDamages((d) => [...d, { zone: newZone, type: newType, comment: newComment.trim() }]);
    setNewComment('');
    setBodyOk(false);
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const room = MAX_PHOTOS - photos.length;
    const list = Array.from(files).slice(0, Math.max(0, room));
    if (list.length < files.length) setError(`${MAX_PHOTOS} photos au maximum par fiche.`);
    for (const file of list) {
      if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) {
        setError('Seules les images sont acceptées.');
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const { blob, ext, type } = await compressImage(file);
        if (blob.size > MAX_UPLOAD_BYTES) throw new Error('Photo trop lourde (10 Mo au maximum).');
        const path = `${organizationId}/${repairOrderId}/${kind}-${Date.now()}-${randomId()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(INSPECTION_BUCKET)
          .upload(path, blob, { contentType: type, upsert: false });
        if (upErr) throw new Error(upErr.message);
        setPhotos((p) => [...p, { path, preview: URL.createObjectURL(blob), uploadedNow: true }]);
      } catch (e) {
        setError(e instanceof Error ? `Photo non envoyée : ${e.message}` : 'Photo non envoyée.');
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function removePhoto(item: PhotoItem) {
    setPhotos((p) => p.filter((x) => x.path !== item.path));
    // Photo envoyée pendant cette saisie et jamais enregistrée : on la retire
    // aussi du stockage (sans bloquer si cela échoue).
    if (item.uploadedNow) {
      void supabase.storage.from(INSPECTION_BUCKET).remove([item.path]);
    }
  }

  async function submit(withSignature: boolean) {
    if (busyRef.current) return;
    setError(null);
    setMessage(null);

    const km = mileage.trim() === '' ? null : Number(mileage.replace(/\s/g, ''));
    if (km !== null && (!Number.isFinite(km) || km < 0)) {
      setError('Kilométrage invalide.');
      return;
    }
    if (withSignature) {
      if (km === null) {
        setError('Relevez le kilométrage avant de faire signer.');
        return;
      }
      if (fuel === null) {
        setError('Indiquez le niveau de carburant avant de faire signer.');
        return;
      }
      if (entryKm !== null && km < entryKm) {
        setError(`Le kilométrage de sortie ne peut pas être inférieur à celui d'entrée (${formatKm(entryKm)}).`);
        return;
      }
      if (!signerName.trim()) {
        setError('Indiquez le nom de la personne qui signe.');
        return;
      }
      if (!padRef.current || padRef.current.isEmpty()) {
        setError('Le client doit signer dans le cadre avant de valider.');
        return;
      }
    }
    if (uploading > 0) {
      setError("Attendez la fin de l'envoi des photos.");
      return;
    }

    busyRef.current = true;
    setBusy(withSignature ? 'sign' : 'draft');
    try {
      let signaturePath: string | null = null;
      if (withSignature) {
        const blob = await padRef.current!.toBlob();
        if (!blob) throw new Error('Signature illisible, recommencez.');
        signaturePath = `${organizationId}/${repairOrderId}/signature-${kind}-${Date.now()}-${randomId()}.png`;
        const { error: upErr } = await supabase.storage
          .from(INSPECTION_BUCKET)
          .upload(signaturePath, blob, { contentType: 'image/png', upsert: false });
        if (upErr) throw new Error(upErr.message);
      }

      const result = await saveInspection({
        repairOrderId,
        kind,
        receptionistName,
        inspectedAt: inspectedAt ? new Date(inspectedAt).toISOString() : new Date().toISOString(),
        mileage: km,
        fuelLevel: fuel,
        checklist: {
          body_ok: bodyOk && damages.length === 0,
          body_damages: damages,
          warning_lights: lights,
          warning_lights_other: lights.includes('autre') ? lightsOther.trim() : '',
          accessories,
          accessories_other: accessories.includes('autre') ? accOther.trim() : '',
        },
        observations,
        photos: photos.map((p) => p.path),
        signaturePath,
        signerName: withSignature ? signerName : null,
      });
      if (result.error) {
        if (signaturePath) void supabase.storage.from(INSPECTION_BUCKET).remove([signaturePath]);
        setError(result.error);
        return;
      }
      // Les photos sont maintenant rattachées à la fiche enregistrée.
      setPhotos((p) => p.map((x) => ({ ...x, uploadedNow: false })));
      if (withSignature) {
        router.refresh();
      } else {
        setMessage('Brouillon enregistré. La fiche reste modifiable jusqu’à la signature du client.');
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de l'enregistrement.");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const checkboxCls =
    'flex items-center gap-3 rounded-lg border px-3 py-3 text-sm cursor-pointer select-none min-h-[48px]';

  return (
    <div className="space-y-4 pb-6">
      {/* ---------- Identification ---------- */}
      <section className="card p-4 space-y-3">
        <h2 className="section-title">{INSPECTION_KIND_LABELS[kind]}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">Réceptionnaire</span>
            <input className="input h-11" value={receptionistName} onChange={(e) => setReceptionistName(e.target.value)} disabled={disabled} />
          </label>
          <label className="block">
            <span className="field-label">Date et heure</span>
            <input
              type="datetime-local"
              className="input h-11"
              value={inspectedAt}
              onChange={(e) => setInspectedAt(e.target.value)}
              disabled={disabled}
            />
          </label>
          <label className="block">
            <span className="field-label">Kilométrage (km)</span>
            <input
              className="input h-11 num"
              inputMode="numeric"
              pattern="[0-9 ]*"
              value={mileage}
              onChange={(e) => setMileage(e.target.value.replace(/[^0-9 ]/g, ''))}
              placeholder={entryKm !== null ? `Entrée : ${formatKm(entryKm)}` : 'Ex. 12500'}
              disabled={disabled}
            />
            {entryKm !== null && mileage.trim() !== '' && Number(mileage.replace(/\s/g, '')) >= entryKm && (
              <span className="text-xs text-encre-3">
                Parcourus depuis l&apos;entrée : {formatKm(Number(mileage.replace(/\s/g, '')) - entryKm)}
              </span>
            )}
          </label>
        </div>
        <div>
          <span className="field-label">Niveau de carburant</span>
          <FuelGauge value={fuel} onChange={setFuel} readOnly={disabled} />
          {reception && kind === 'restitution' && (
            <p className="text-xs text-encre-3 mt-1">À l&apos;entrée : {fuelLabel(reception.fuel_level)}</p>
          )}
        </div>
      </section>

      {/* ---------- Carrosserie ---------- */}
      <section className="card p-4 space-y-3">
        <h3 className="card-title">Carrosserie et rayures</h3>
        {fromEntry && damages.length > 0 && (
          <p className="text-xs text-encre-3">Les dégâts relevés à l&apos;entrée sont repris. Ajoutez uniquement ce qui est nouveau.</p>
        )}
        <label className={`${checkboxCls} ${bodyOk && damages.length === 0 ? 'border-nuit bg-[#E6EBF3]' : 'border-trait'}`}>
          <input
            type="checkbox"
            className="h-6 w-6 accent-[#1B2A4A]"
            checked={bodyOk && damages.length === 0}
            onChange={(e) => setBodyOk(e.target.checked)}
            disabled={disabled || damages.length > 0}
          />
          Aucun dégât visible
        </label>

        {damages.length > 0 && (
          <ul className="space-y-2">
            {damages.map((d, i) => (
              <li key={`${d.zone}-${d.type}-${i}`} className="flex items-start justify-between gap-2 rounded-lg border border-trait px-3 py-2">
                <div className="text-sm">
                  <span className="font-medium">{zoneLabel(d.zone)}</span> : {damageLabel(d.type)}
                  {d.comment && <span className="block text-xs text-encre-3">{d.comment}</span>}
                </div>
                <button
                  type="button"
                  onClick={() => setDamages((list) => list.filter((_, j) => j !== i))}
                  disabled={disabled}
                  className="btn-ghost btn-sm"
                  aria-label="Retirer ce dégât"
                >
                  <IconX className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
          <label className="block">
            <span className="field-label">Zone</span>
            <select className="input h-11" value={newZone} onChange={(e) => setNewZone(e.target.value)} disabled={disabled}>
              {BODY_ZONES.map((z) => (
                <option key={z.key} value={z.key}>
                  {z.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Type de dégât</span>
            <select className="input h-11" value={newType} onChange={(e) => setNewType(e.target.value)} disabled={disabled}>
              {DAMAGE_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="field-label">Commentaire (facultatif)</span>
          <input
            className="input h-11"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Ex. rayure de 10 cm sur la portière"
            disabled={disabled}
          />
        </label>
        <button type="button" onClick={addDamage} disabled={disabled} className="btn-secondary w-full h-11">
          Ajouter ce dégât
        </button>
      </section>

      {/* ---------- Voyants ---------- */}
      <section className="card p-4 space-y-3">
        <h3 className="card-title">Voyants allumés au tableau de bord</h3>
        <p className="text-xs text-encre-3">Cochez les voyants allumés moteur tournant. Aucun coché = aucun voyant allumé.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {WARNING_LIGHTS.map((l) => {
            const on = lights.includes(l.key);
            return (
              <label key={l.key} className={`${checkboxCls} ${on ? 'border-[#D98A1C] bg-[#FBF0DC]' : 'border-trait'}`}>
                <input
                  type="checkbox"
                  className="h-6 w-6 accent-[#A6620A]"
                  checked={on}
                  onChange={() => toggle(lights, setLights, l.key)}
                  disabled={disabled}
                />
                {l.label}
              </label>
            );
          })}
        </div>
        {lights.includes('autre') && (
          <input
            className="input h-11"
            value={lightsOther}
            onChange={(e) => setLightsOther(e.target.value)}
            placeholder="Précisez le voyant"
            disabled={disabled}
          />
        )}
      </section>

      {/* ---------- Accessoires ---------- */}
      <section className="card p-4 space-y-3">
        <h3 className="card-title">Accessoires présents</h3>
        {fromEntry && <p className="text-xs text-encre-3">Pré-coché avec les accessoires présents à l&apos;entrée : décochez ce qui manque.</p>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ACCESSORIES.map((a) => {
            const on = accessories.includes(a.key);
            return (
              <label key={a.key} className={`${checkboxCls} ${on ? 'border-nuit bg-[#E6EBF3]' : 'border-trait'}`}>
                <input
                  type="checkbox"
                  className="h-6 w-6 accent-[#1B2A4A]"
                  checked={on}
                  onChange={() => toggle(accessories, setAccessories, a.key)}
                  disabled={disabled}
                />
                {a.label}
              </label>
            );
          })}
        </div>
        {accessories.includes('autre') && (
          <input
            className="input h-11"
            value={accOther}
            onChange={(e) => setAccOther(e.target.value)}
            placeholder="Précisez l'accessoire"
            disabled={disabled}
          />
        )}
      </section>

      {/* ---------- Observations et photos ---------- */}
      <section className="card p-4 space-y-3">
        <h3 className="card-title">Observations</h3>
        <textarea
          className="input min-h-[96px]"
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          placeholder="Objets laissés dans le véhicule, état des pneus, demande particulière du client..."
          disabled={disabled}
        />

        <div className="space-y-2">
          <span className="field-label">Photos (facultatif)</span>
          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {photos.map((p) => (
                <div key={p.path} className="relative aspect-square overflow-hidden rounded-md border border-trait bg-papier">
                  {p.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.preview} alt="Photo du véhicule" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-xs text-encre-3">Photo</span>
                  )}
                  <button
                    type="button"
                    onClick={() => removePhoto(p)}
                    disabled={disabled}
                    className="absolute right-1 top-1 rounded bg-white/90 p-1 text-rouge"
                    aria-label="Retirer la photo"
                  >
                    <IconX className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <label className={`btn-secondary w-full h-12 cursor-pointer ${disabled || photos.length >= MAX_PHOTOS ? 'pointer-events-none opacity-50' : ''}`}>
            <IconCamera className="w-4 h-4" />
            {uploading > 0 ? `Envoi en cours (${uploading})...` : 'Prendre ou ajouter une photo'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="sr-only"
              onChange={(e) => {
                void onFiles(e.target.files);
                e.target.value = '';
              }}
              disabled={disabled || photos.length >= MAX_PHOTOS}
            />
          </label>
        </div>
      </section>

      {/* ---------- Signature client ---------- */}
      <section className="card p-4 space-y-3">
        <h3 className="card-title">Signature du client</h3>
        <p className="text-xs text-encre-3">
          {kind === 'reception'
            ? "Le client confirme l'état du véhicule à la remise des clés. Après signature, la fiche n'est plus modifiable."
            : "Le client confirme l'état du véhicule à la restitution. Après signature, la fiche n'est plus modifiable."}
        </p>
        <label className="block">
          <span className="field-label">Nom de la personne qui signe</span>
          <input
            className="input h-11"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder="Prénom et nom"
            disabled={disabled}
          />
        </label>
        <InspectionSignaturePad ref={padRef} disabled={disabled} onChange={setHasSignature} />
      </section>

      {error && <p className="rounded-md bg-rouge-clair px-3 py-2 text-sm text-rouge">{error}</p>}
      {message && <p className="rounded-md bg-[#E3F3EA] px-3 py-2 text-sm text-[#12804F]">{message}</p>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={disabled || uploading > 0}
          className="btn-secondary h-12 flex-1"
        >
          {busy === 'draft' ? 'Enregistrement...' : 'Enregistrer sans signature'}
        </button>
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={disabled || uploading > 0 || !hasSignature}
          className="btn-primary h-12 flex-1"
        >
          {busy === 'sign' ? 'Enregistrement...' : 'Valider avec la signature du client'}
        </button>
      </div>
    </div>
  );
}
