'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { isStorageUrlInBucket } from '@/lib/documents/pdf/storage-to-data-uri';

// Renvoie l'organization_id de l'utilisateur courant — nécessaire côté
// client pour construire le chemin d'upload ("<organization_id>/<produit>/...")
// avant même que la photo existe en base.
export async function getCurrentOrganizationId() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifie');

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile) throw new Error('Profil introuvable');
  return profile.organization_id as string;
}

export async function getProductPhotos(productId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('product_photos')
    .select('id, url, storage_path, position, created_at')
    .eq('product_id', productId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Enregistre en base une photo déjà envoyée dans le bucket "vehicle-photos"
// par le composant client (l'upload lui-même se fait directement depuis le
// navigateur avec le client Supabase "anon" + RLS, comme pour le logo de
// l'organisation — inutile de faire transiter le fichier par le serveur).
export async function addProductPhoto(input: { productId: string; storagePath: string; url: string }) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifie');

  const organizationId = await getCurrentOrganizationId();

  const { data: existing } = await supabase
    .from('product_photos')
    .select('position')
    .eq('product_id', input.productId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = (existing?.position ?? -1) + 1;

  // La photo doit être un fichier du dossier "vehicle-photos" de notre
  // stockage : la fiche PDF publique du véhicule l'embarque.
  if (!isStorageUrlInBucket(input.url, 'vehicle-photos') || input.storagePath.includes('..')) {
    throw new Error('Photo invalide.');
  }

  const { data, error } = await supabase
    .from('product_photos')
    .insert({
      organization_id: organizationId,
      product_id: input.productId,
      storage_path: input.storagePath,
      url: input.url,
      position: nextPosition,
      uploaded_by: userData.user.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  revalidatePath(`/products/${input.productId}`);
  return { id: data.id as string };
}

// Supprime la ligne en base ET le fichier dans le bucket. On utilise le
// client admin (service_role) pour le retrait du fichier storage : la
// policy RLS de suppression sur `product_photos` a déjà validé le droit de
// l'utilisateur (auteur ou rôle habilité) avant d'arriver ici, donc il n'y a
// pas de contournement de sécurité — juste une garantie que le fichier est
// bien retiré même si sa policy storage.objects diverge un jour de celle de
// la table.
export async function deleteProductPhoto(photoId: string) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifie');

  const { data: photo, error: fetchError } = await supabase
    .from('product_photos')
    .select('id, product_id, storage_path')
    .eq('id', photoId)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (!photo) throw new Error('Photo introuvable');

  const { data: deleted, error: deleteError } = await supabase.from('product_photos').delete().eq('id', photoId).select('id');
  if (deleteError) throw new Error(deleteError.message);
  // Suppression refusée par la RLS (0 ligne) : on ne touche surtout pas au
  // fichier, sinon n'importe quel employé pouvait effacer une photo.
  if (!deleted || deleted.length === 0) throw new Error("Vous n'avez pas le droit de supprimer cette photo.");

  const admin = createAdminClient();
  await admin.storage.from('vehicle-photos').remove([photo.storage_path]);

  revalidatePath(`/products/${photo.product_id}`);
}
