'use server';

// Fiche de réception / restitution SAV (migration 0047).
// Les règles métier sont garanties par la base (trigger
// vehicle_inspections_guard) : restitution seulement après une réception
// signée, fiche figée après signature, chemins de fichiers limités au
// dossier de l'ordre de réparation. Ici on renvoie { error } au lieu de
// lever une erreur pour que le message s'affiche aussi en production.

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import {
  INSPECTION_BUCKET,
  INSPECTION_COLUMNS,
  normalizeChecklist,
  type InspectionChecklist,
  type InspectionKind,
  type InspectionRow,
} from '@/lib/atelier/inspection-config';

function isKind(v: string): v is InspectionKind {
  return v === 'reception' || v === 'restitution';
}

function toRow(raw: Record<string, unknown>): InspectionRow {
  return {
    ...(raw as unknown as InspectionRow),
    checklist: normalizeChecklist(raw.checklist),
    photos: Array.isArray(raw.photos) ? (raw.photos as string[]) : [],
  };
}

export async function getInspections(repairOrderId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('vehicle_inspections')
    .select(INSPECTION_COLUMNS)
    .eq('repair_order_id', repairOrderId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((r) => toRow(r as Record<string, unknown>));
  return {
    reception: rows.find((r) => r.kind === 'reception') ?? null,
    restitution: rows.find((r) => r.kind === 'restitution') ?? null,
  };
}

// Liens temporaires (10 minutes) vers les photos et signatures, lus avec la
// session de l'utilisateur : la policy du bucket privé décide.
export async function signInspectionFiles(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase.storage.from(INSPECTION_BUCKET).createSignedUrls(unique, 600);
  const map: Record<string, string> = {};
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
  }
  return map;
}

export async function getInspectionContext(repairOrderId: string) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifié');

  const [{ data: profile }, { data: order, error: orderError }] = await Promise.all([
    supabase.from('profiles').select('full_name, role, organization_id').eq('id', userData.user.id).maybeSingle(),
    supabase
      .from('repair_orders')
      .select(
        'id, organization_id, order_number, vehicle_label, vehicle_plate, vehicle_vin, vehicle_mileage_in, status, opened_at, clients(first_name, last_name, company_name, phone)'
      )
      .eq('id', repairOrderId)
      .maybeSingle(),
  ]);
  if (orderError) throw new Error(orderError.message);

  return {
    order,
    userName: (profile?.full_name as string | null) ?? '',
    role: (profile?.role as string | null) ?? null,
  };
}

export interface SaveInspectionInput {
  repairOrderId: string;
  kind: InspectionKind;
  receptionistName: string;
  inspectedAt: string;
  mileage: number | null;
  fuelLevel: number | null;
  checklist: InspectionChecklist;
  observations: string;
  photos: string[];
  // Signature : chemin de l'image déjà envoyée dans le bucket + nom du signataire.
  signaturePath?: string | null;
  signerName?: string | null;
}

export async function saveInspection(input: SaveInspectionInput): Promise<{ error?: string; id?: string }> {
  try {
    if (!isKind(input.kind)) return { error: 'Type de fiche inconnu.' };
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return { error: 'Session expirée, reconnectez-vous.' };

    const { data: order, error: orderError } = await supabase
      .from('repair_orders')
      .select('id, organization_id')
      .eq('id', input.repairOrderId)
      .maybeSingle();
    if (orderError) return { error: orderError.message };
    if (!order) return { error: 'Ordre de réparation introuvable.' };

    const mileage =
      input.mileage === null || input.mileage === undefined || Number.isNaN(input.mileage)
        ? null
        : Math.round(Number(input.mileage));
    if (mileage !== null && (mileage < 0 || mileage > 5_000_000)) {
      return { error: 'Kilométrage invalide.' };
    }
    const fuel =
      input.fuelLevel === null || input.fuelLevel === undefined ? null : Math.round(Number(input.fuelLevel));
    if (fuel !== null && (fuel < 0 || fuel > 8)) return { error: 'Niveau de carburant invalide.' };

    const inspectedAt = input.inspectedAt ? new Date(input.inspectedAt) : new Date();
    if (Number.isNaN(inspectedAt.getTime())) return { error: 'Date et heure invalides.' };

    const prefix = `${order.organization_id}/${order.id}/`;
    const photos = (input.photos ?? []).filter((p) => typeof p === 'string' && p.startsWith(prefix));
    if (photos.length > 20) return { error: '20 photos au maximum par fiche.' };

    const checklist = normalizeChecklist(input.checklist);
    const payload: Record<string, unknown> = {
      receptionist_name: input.receptionistName?.trim() || null,
      inspected_at: inspectedAt.toISOString(),
      mileage,
      fuel_level: fuel,
      checklist,
      observations: input.observations?.trim() || null,
      photos,
    };

    if (input.signaturePath) {
      const signer = input.signerName?.trim();
      if (!signer) return { error: 'Indiquez le nom de la personne qui signe.' };
      if (!input.signaturePath.startsWith(prefix)) return { error: 'Signature invalide.' };
      payload.client_signature_url = input.signaturePath;
      payload.client_signer_name = signer;
    }

    const { data: existing } = await supabase
      .from('vehicle_inspections')
      .select('id, client_signed_at')
      .eq('repair_order_id', order.id)
      .eq('kind', input.kind)
      .maybeSingle();

    let id: string;
    if (existing) {
      if (existing.client_signed_at) return { error: 'Fiche déjà signée par le client : elle ne peut plus être modifiée.' };
      const { data, error } = await supabase
        .from('vehicle_inspections')
        .update(payload)
        .eq('id', existing.id)
        .select('id')
        .maybeSingle();
      if (error) return { error: error.message };
      if (!data) return { error: "Vous n'avez pas le droit de modifier cette fiche." };
      id = data.id as string;
    } else {
      const { data, error } = await supabase
        .from('vehicle_inspections')
        .insert({
          ...payload,
          organization_id: order.organization_id,
          repair_order_id: order.id,
          kind: input.kind,
        })
        .select('id')
        .single();
      if (error) {
        if (error.code === '23505') return { error: 'Cette fiche existe déjà : rechargez la page.' };
        if (error.code === '42501') return { error: "Vous n'avez pas le droit de remplir cette fiche." };
        return { error: error.message };
      }
      id = data.id as string;
    }

    revalidatePath(`/atelier/${order.id}`);
    revalidatePath(`/atelier/${order.id}/inspection/${input.kind}`);
    return { id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur lors de l'enregistrement." };
  }
}
