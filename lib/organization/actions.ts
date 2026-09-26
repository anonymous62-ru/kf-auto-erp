'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface OrganizationProfile {
  id: string;
  name: string;
  logo_url: string | null;
  address: string | null;
  phones: string | null;
  bank_name: string | null;
  bank_account: string | null;
  rccm: string | null;
  nif: string | null;
  cnss_number: string | null;
  terms_and_conditions: string | null;
}

export async function getMyOrganization(): Promise<OrganizationProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Pas de filtre .eq('id', ...) ici : la policy RLS "organizations_select"
  // (id = auth_org_id()) restreint déjà le résultat à exactement la propre
  // organisation de l'utilisateur, quel que soit son rôle (contrairement à
  // "profiles", où un admin voit plusieurs lignes). Filtrer en plus par
  // profile.organization_id ne changeait rien en théorie, mais si les deux
  // valeurs divergent pour une raison quelconque (session/JWT pas encore
  // rafraîchi après un changement d'organisation, par exemple), le filtre
  // explicite peut ne matcher aucune ligne alors que la policy, elle,
  // matcherait — d'où l'erreur "Cannot coerce the result to a single JSON
  // object" (0 ligne) rencontrée par l'utilisateur. On laisse la RLS seule
  // décider, ce qui élimine ce risque de désaccord.
  const { data: organization, error } = await supabase
    .from('organizations')
    .select(
      'id, name, logo_url, address, phones, bank_name, bank_account, rccm, nif, cnss_number, terms_and_conditions'
    )
    .maybeSingle();
  if (error) throw new Error(error.message);
  return organization;
}

export async function updateOrganization(input: {
  id: string;
  name: string;
  logoUrl?: string | null;
  address?: string | null;
  phones?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  rccm?: string | null;
  nif?: string | null;
  cnssNumber?: string | null;
  termsAndConditions?: string | null;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Non authentifié');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!profile || !['super_admin', 'administrateur'].includes(profile.role)) {
    throw new Error("Seuls les administrateurs peuvent modifier les informations de l'organisation.");
  }

  if (!input.name.trim()) throw new Error("Le nom de l'organisation est obligatoire");

  const update: Record<string, unknown> = {
    name: input.name,
    address: input.address || null,
    phones: input.phones || null,
    bank_name: input.bankName || null,
    bank_account: input.bankAccount || null,
    rccm: input.rccm || null,
    nif: input.nif || null,
    cnss_number: input.cnssNumber || null,
    terms_and_conditions: input.termsAndConditions || null,
  };
  // logoUrl n'est mis à jour que s'il est explicitement fourni (le champ est
  // géré séparément côté client via l'upload direct vers Supabase Storage,
  // qui appelle updateOrganizationLogo — voir plus bas).
  if (input.logoUrl !== undefined) update.logo_url = input.logoUrl;

  const { error } = await supabase.from('organizations').update(update).eq('id', input.id);
  if (error) throw new Error(error.message);

  revalidatePath('/settings/organisation');
  revalidatePath('/dashboard');
}

export async function updateOrganizationLogo(organizationId: string, logoUrl: string | null) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Non authentifié');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!profile || !['super_admin', 'administrateur'].includes(profile.role)) {
    throw new Error('Seuls les administrateurs peuvent modifier le logo.');
  }

  const { error } = await supabase
    .from('organizations')
    .update({ logo_url: logoUrl })
    .eq('id', organizationId);
  if (error) throw new Error(error.message);

  revalidatePath('/settings/organisation');
  revalidatePath('/dashboard');
}
