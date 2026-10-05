'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

export type ProspectStatus =
  | 'nouveau'
  | 'contacte'
  | 'interesse'
  | 'rdv_planifie'
  | 'negociation'
  | 'converti'
  | 'perdu';

export type ProspectSource =
  | 'showroom'
  | 'appel'
  | 'whatsapp'
  | 'site_web'
  | 'reseaux_sociaux'
  | 'recommandation'
  | 'autre';

export type ActivityType = 'relance' | 'appel' | 'whatsapp' | 'email' | 'visite' | 'autre';
export type AppointmentStatus = 'planifie' | 'confirme' | 'realise' | 'annule' | 'absent';

export interface CreateProspectInput {
  companyName?: string;
  contactName?: string;
  sector?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  source?: ProspectSource;
  vehicleInterestId?: string;
  vehicleInterest?: string;
  notes?: string;
  nextRelanceAt?: string; // ISO date
}

async function getCurrentProfile(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifié');
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile) throw new Error('Profil introuvable');
  return { user: userData.user, profile };
}

export async function createProspect(input: CreateProspectInput) {
  const supabase = await createClient();
  const { user, profile } = await getCurrentProfile(supabase);

  if (!input.companyName?.trim() && !input.firstName?.trim() && !input.lastName?.trim() && !input.phone?.trim()) {
    throw new Error('Renseignez au moins un nom ou un téléphone.');
  }

  const { data: prospect, error } = await supabase
    .from('prospects')
    .insert({
      organization_id: profile.organization_id,
      assigned_to: user.id,
      created_by: user.id,
      company_name: input.companyName || null,
      contact_name: input.contactName || null,
      sector: input.sector || null,
      first_name: input.firstName || null,
      last_name: input.lastName || null,
      phone: input.phone || null,
      whatsapp: input.whatsapp || null,
      email: input.email || null,
      source: input.source || 'autre',
      vehicle_interest_id: input.vehicleInterestId || null,
      vehicle_interest: input.vehicleInterest || null,
      notes: input.notes || null,
      next_relance_at: input.nextRelanceAt || null,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  redirect(`/prospects/${prospect.id}`);
}

export async function getProspects(statusFilter?: ProspectStatus) {
  const supabase = await createClient();
  let request = supabase
    .from('prospects')
    .select(
      'id, first_name, last_name, company_name, contact_name, sector, phone, status, source, vehicle_interest, next_relance_at, created_at'
    )
    .order('created_at', { ascending: false })
    .limit(500);

  if (statusFilter) request = request.eq('status', statusFilter);

  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getProspect(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prospects')
    .select(
      'id, first_name, last_name, company_name, contact_name, sector, phone, whatsapp, email, source, status, vehicle_interest_id, vehicle_interest, notes, next_relance_at, last_contact_at, client_id, products:vehicle_interest_id(designation)'
    )
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export interface UpdateProspectInput extends CreateProspectInput {
  id: string;
  status?: ProspectStatus;
}

export async function updateProspect(input: UpdateProspectInput) {
  const supabase = await createClient();
  await getCurrentProfile(supabase);

  const { error } = await supabase
    .from('prospects')
    .update({
      first_name: input.firstName || null,
      last_name: input.lastName || null,
      phone: input.phone || null,
      whatsapp: input.whatsapp || null,
      email: input.email || null,
      source: input.source || 'autre',
      vehicle_interest_id: input.vehicleInterestId || null,
      vehicle_interest: input.vehicleInterest || null,
      notes: input.notes || null,
      // Champs mis à jour seulement s'ils sont fournis : le formulaire de
      // modification n'envoie pas la date de relance, qui était jusqu'ici
      // effacée à chaque modification de la fiche.
      ...(input.nextRelanceAt !== undefined ? { next_relance_at: input.nextRelanceAt || null } : {}),
      ...(input.companyName !== undefined ? { company_name: input.companyName || null } : {}),
      ...(input.contactName !== undefined ? { contact_name: input.contactName || null } : {}),
      ...(input.sector !== undefined ? { sector: input.sector || null } : {}),
      ...(input.status ? { status: input.status } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.id);
  if (error) throw new Error(error.message);

  revalidatePath(`/prospects/${input.id}`);
  revalidatePath('/prospects');
}

export async function updateProspectStatus(id: string, status: ProspectStatus) {
  const supabase = await createClient();
  const { error } = await supabase
    .from('prospects')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath(`/prospects/${id}`);
  revalidatePath('/prospects');
}

// --- Relances / activités -----------------------------------------------

export async function addProspectActivity(input: {
  prospectId: string;
  activityType: ActivityType;
  notes?: string;
  nextRelanceAt?: string;
}) {
  const supabase = await createClient();
  const { user, profile } = await getCurrentProfile(supabase);

  const { error } = await supabase.from('prospect_activities').insert({
    organization_id: profile.organization_id,
    prospect_id: input.prospectId,
    activity_type: input.activityType,
    notes: input.notes || null,
    performed_by: user.id,
  });
  if (error) throw new Error(error.message);

  const { error: updateError } = await supabase
    .from('prospects')
    .update({
      last_contact_at: new Date().toISOString(),
      next_relance_at: input.nextRelanceAt || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.prospectId);
  if (updateError) throw new Error(updateError.message);

  revalidatePath(`/prospects/${input.prospectId}`);
  revalidatePath('/prospects');
}

export async function getProspectActivities(prospectId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prospect_activities')
    .select('id, activity_type, notes, created_at')
    .eq('prospect_id', prospectId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// --- Rendez-vous -----------------------------------------------------------

export async function createAppointment(input: {
  prospectId: string;
  scheduledAt: string;
  location?: string;
  notes?: string;
}) {
  const supabase = await createClient();
  const { user, profile } = await getCurrentProfile(supabase);

  if (!input.scheduledAt) throw new Error('La date du rendez-vous est obligatoire.');

  const { error } = await supabase.from('prospect_appointments').insert({
    organization_id: profile.organization_id,
    prospect_id: input.prospectId,
    scheduled_at: input.scheduledAt,
    location: input.location || null,
    notes: input.notes || null,
    created_by: user.id,
  });
  if (error) throw new Error(error.message);

  await supabase
    .from('prospects')
    .update({ status: 'rdv_planifie', updated_at: new Date().toISOString() })
    .eq('id', input.prospectId)
    .in('status', ['nouveau', 'contacte', 'interesse']);

  revalidatePath(`/prospects/${input.prospectId}`);
  revalidatePath('/prospects');
}

export async function getProspectAppointments(prospectId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prospect_appointments')
    .select('id, scheduled_at, location, notes, status')
    .eq('prospect_id', prospectId)
    .order('scheduled_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function updateAppointmentStatus(id: string, prospectId: string, status: AppointmentStatus) {
  const supabase = await createClient();
  const { error } = await supabase.from('prospect_appointments').update({ status }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath(`/prospects/${prospectId}`);
}

export async function getUpcomingAppointments() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prospect_appointments')
    .select('id, scheduled_at, location, status, prospects(id, first_name, last_name, phone)')
    .in('status', ['planifie', 'confirme'])
    .order('scheduled_at', { ascending: true })
    .limit(20);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// --- Conversion en client ----------------------------------------------

export async function convertProspectToClient(prospectId: string) {
  const supabase = await createClient();
  const { user, profile } = await getCurrentProfile(supabase);

  const { data: prospect, error: prospectError } = await supabase
    .from('prospects')
    .select('id, first_name, last_name, company_name, contact_name, sector, phone, whatsapp, email, assigned_to, notes, client_id')
    .eq('id', prospectId)
    .single();
  if (prospectError) throw new Error(prospectError.message);
  if (prospect.client_id) redirect(`/clients/${prospect.client_id}`);

  const { data: client, error: clientError } = await supabase
    .from('clients')
    .insert({
      organization_id: profile.organization_id,
      assigned_to: prospect.assigned_to ?? user.id,
      created_by: user.id,
      // Prospect importé depuis un fichier d'entreprises (migration 0021) :
      // on garde la raison sociale et la personne à contacter.
      client_type: prospect.company_name ? 'entreprise' : 'particulier',
      company_name: prospect.company_name,
      main_contact_name: prospect.contact_name,
      first_name: prospect.first_name,
      last_name: prospect.last_name,
      phone: prospect.phone,
      whatsapp: prospect.whatsapp,
      email: prospect.email,
      notes: [prospect.sector ? `Secteur : ${prospect.sector}` : '', prospect.notes ?? ''].filter(Boolean).join('\n') || null,
    })
    .select('id')
    .single();
  if (clientError) throw new Error(clientError.message);

  const { error: updateError } = await supabase
    .from('prospects')
    .update({ status: 'converti', client_id: client.id, updated_at: new Date().toISOString() })
    .eq('id', prospectId);
  if (updateError) throw new Error(updateError.message);

  revalidatePath('/prospects');
  revalidatePath('/clients');
  redirect(`/clients/${client.id}`);
}
