'use client';

import { useState } from 'react';
import { formatCFA } from '@/lib/documents/calculations';
import { IconChat } from '@/components/icons';

// Partage rapide d'un véhicule au client par WhatsApp : pas besoin qu'il ait
// un compte, ni que ce soit forcément un client déjà enregistré — on
// demande juste son numéro au moment de l'envoi, comme pour un partage
// occasionnel (prospect au showroom, contact WhatsApp externe...).
export function VehicleWhatsappShare({
  productId,
  designation,
  brand,
  model,
  salePrice,
  photoUrls,
}: {
  productId: string;
  designation: string;
  brand?: string | null;
  model?: string | null;
  salePrice: number;
  photoUrls: string[];
}) {
  const [phone, setPhone] = useState('');
  const [sharingPhotos, setSharingPhotos] = useState(false);
  const [photoShareError, setPhotoShareError] = useState<string | null>(null);

  const sheetUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/products/${productId}/pdf` : '';
  const vehicleLabel = [brand, model].filter(Boolean).join(' ') || designation;
  const captionText = `${vehicleLabel} (${designation}) - ${formatCFA(salePrice)} - KF Auto`;
  const message =
    `Bonjour, voici le véhicule qui pourrait vous intéresser chez KF Auto : ${vehicleLabel} ` +
    `(${designation}) - ${formatCFA(salePrice)}. Fiche complète avec photos : ${sheetUrl}`;

  function handleShareLink() {
    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone) {
      // pas de numéro : on ouvre WhatsApp Web sans destinataire pré-rempli,
      // l'utilisateur choisit le contact lui-même dans l'application.
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
      return;
    }
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
  }

  // Envoie les VRAIES photos (pas juste un lien) via la fenêtre de partage
  // native du téléphone — la même que celle qui s'ouvre depuis la galerie
  // photo. C'est la seule façon fiable d'envoyer des images directement dans
  // WhatsApp : contrairement au lien "wa.me", cette API ne permet pas de
  // présélectionner le contact — l'utilisateur choisit WhatsApp puis le
  // destinataire dans la fenêtre qui s'ouvre. Fonctionne sur téléphone
  // (Android/iPhone) ; sur ordinateur, la plupart des navigateurs ne savent
  // pas partager des fichiers ainsi (bouton grisé dans ce cas, on retombe
  // sur le lien de la fiche PDF ci-dessus).
  async function handleSharePhotos() {
    setPhotoShareError(null);
    setSharingPhotos(true);
    try {
      const files = await Promise.all(
        photoUrls.map(async (url, index) => {
          const response = await fetch(url);
          const blob = await response.blob();
          const ext = blob.type.includes('png') ? 'png' : 'jpg';
          return new File([blob], `${designation || 'vehicule'}-${index + 1}.${ext}`, { type: blob.type });
        })
      );

      const shareData = { files, text: captionText };
      if (!navigator.canShare || !navigator.canShare(shareData)) {
        setPhotoShareError(
          "Ton navigateur ne permet pas d'envoyer des photos directement. Utilise le bouton \"Fiche PDF\" ci-dessous, ou ouvre cette page depuis ton téléphone."
        );
        return;
      }
      await navigator.share(shareData);
    } catch (e) {
      // AbortError = l'utilisateur a juste fermé la fenêtre de partage, pas une vraie erreur
      if (e instanceof Error && e.name === 'AbortError') return;
      setPhotoShareError(e instanceof Error ? e.message : "Échec de l'envoi des photos.");
    } finally {
      setSharingPhotos(false);
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-kf-navy">Partager ce véhicule</p>
        <p className="text-xs text-gray-400 mt-0.5">
          "Envoyer les photos" transmet les vraies images (idéal sur téléphone). "Fiche PDF" envoie un lien.
        </p>
      </div>

      <button
        onClick={handleSharePhotos}
        disabled={sharingPhotos || photoUrls.length === 0}
        className="w-full flex items-center justify-center gap-1.5 bg-green-600 text-white rounded-md py-2.5 text-sm font-medium disabled:opacity-50"
      >
        <IconChat className="w-4 h-4" />
        {sharingPhotos ? 'Préparation...' : photoUrls.length === 0 ? 'Aucune photo à envoyer' : 'Envoyer les photos'}
      </button>
      {photoShareError && <p className="text-xs text-red-600">{photoShareError}</p>}

      <div className="border-t pt-2 space-y-2">
        <label className="text-xs text-gray-500 block">
          Numéro du client (optionnel, pour le lien PDF)
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+228 ..."
            className="w-full border rounded-md px-2 py-1.5 text-sm mt-0.5"
          />
        </label>
        <button onClick={handleShareLink} className="w-full border border-green-600 text-green-700 rounded-md py-2 text-sm font-medium">
          Envoyer la fiche PDF (lien)
        </button>
      </div>
    </div>
  );
}
