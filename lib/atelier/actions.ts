'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

async function getProfile() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifie');
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile) throw new Error('Profil introuvable');
  return { supabase, userId: userData.user.id, ...profile };
}

// ---------- Rendez-vous ----------
export async function getAppointments() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('workshop_appointments')
    .select('id, client_id, vehicle_label, vehicle_plate, scheduled_at, reason, status, clients(first_name, last_name, company_name)')
    .order('scheduled_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createAppointment(input: {
  clientId?: string;
  vehicleVin?: string;
  vehiclePlate?: string;
  vehicleLabel?: string;
  scheduledAt: string;
  reason?: string;
}) {
  const { supabase, organization_id, userId } = await getProfile();
  if (!input.scheduledAt) throw new Error('La date du rendez-vous est obligatoire');

  const { error } = await supabase.from('workshop_appointments').insert({
    organization_id,
    client_id: input.clientId || null,
    vehicle_vin: input.vehicleVin || null,
    vehicle_plate: input.vehiclePlate || null,
    vehicle_label: input.vehicleLabel || null,
    scheduled_at: input.scheduledAt,
    reason: input.reason || null,
    status: 'planifie',
    created_by: userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/atelier');
}

export async function updateAppointmentStatus(id: string, status: 'planifie' | 'confirme' | 'realise' | 'annule') {
  const { supabase } = await getProfile();
  const { error } = await supabase.from('workshop_appointments').update({ status }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/atelier');
}

// ---------- Ordres de réparation ----------
export async function getRepairOrders() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('repair_orders')
    .select(
      'id, order_number, vehicle_label, vehicle_plate, status, quote_status, quote_total, opened_at, clients(first_name, last_name, company_name)'
    )
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getRepairOrder(id: string) {
  const supabase = await createClient();
  const { data: order, error } = await supabase
    .from('repair_orders')
    .select('*, clients(id, first_name, last_name, company_name, phone)')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);

  const { data: items, error: itemsError } = await supabase
    .from('repair_order_items')
    .select('id, item_type, part_id, designation, quantity, unit_price, position')
    .eq('repair_order_id', id)
    .order('position');
  if (itemsError) throw new Error(itemsError.message);

  return { order, items: items ?? [] };
}

export async function createRepairOrder(input: {
  appointmentId?: string;
  clientId?: string;
  vehicleVin?: string;
  vehiclePlate?: string;
  vehicleLabel?: string;
  vehicleMileageIn?: number;
  diagnostic?: string;
  laborRate?: number;
}) {
  const { supabase, organization_id, userId } = await getProfile();
  const year = new Date().getFullYear();

  const { data: orderNumber, error: numberError } = await supabase.rpc('get_next_repair_order_number', {
    p_organization_id: organization_id,
    p_year: year,
  });
  if (numberError) throw new Error(numberError.message);

  const { data: order, error } = await supabase
    .from('repair_orders')
    .insert({
      organization_id,
      order_number: orderNumber,
      appointment_id: input.appointmentId || null,
      client_id: input.clientId || null,
      vehicle_vin: input.vehicleVin || null,
      vehicle_plate: input.vehiclePlate || null,
      vehicle_label: input.vehicleLabel || null,
      vehicle_mileage_in: input.vehicleMileageIn ?? null,
      receptionist_id: userId,
      diagnostic: input.diagnostic || null,
      labor_rate: input.laborRate ?? 0,
      status: 'ouvert',
      quote_status: 'en_attente',
      created_by: userId,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  if (input.appointmentId) {
    await supabase.from('workshop_appointments').update({ status: 'realise' }).eq('id', input.appointmentId);
  }

  revalidatePath('/atelier');
  return { id: order.id as string };
}

export async function updateRepairOrderDiagnostic(input: {
  id: string;
  diagnostic?: string;
  technicianId?: string;
  laborHoursPlanned?: number;
  laborHoursActual?: number;
  laborRate?: number;
  vehicleMileageIn?: number;
}) {
  const { supabase } = await getProfile();
  const { error } = await supabase
    .from('repair_orders')
    .update({
      diagnostic: input.diagnostic,
      technician_id: input.technicianId || null,
      labor_hours_planned: input.laborHoursPlanned,
      labor_hours_actual: input.laborHoursActual,
      labor_rate: input.laborRate,
      vehicle_mileage_in: input.vehicleMileageIn,
    })
    .eq('id', input.id);
  if (error) throw new Error(error.message);
  revalidatePath(`/atelier/${input.id}`);
}

// ---------- Lignes (main d'œuvre / pièces) ----------
export async function addRepairOrderItem(input: {
  repairOrderId: string;
  itemType: 'main_oeuvre' | 'piece';
  partId?: string;
  designation: string;
  quantity: number;
  unitPrice: number;
}) {
  const { supabase, organization_id } = await getProfile();
  if (!input.designation.trim()) throw new Error('La désignation est obligatoire');

  const { count } = await supabase
    .from('repair_order_items')
    .select('*', { count: 'exact', head: true })
    .eq('repair_order_id', input.repairOrderId);

  const { error } = await supabase.from('repair_order_items').insert({
    organization_id,
    repair_order_id: input.repairOrderId,
    item_type: input.itemType,
    part_id: input.partId || null,
    designation: input.designation,
    quantity: input.quantity,
    unit_price: input.unitPrice,
    position: count ?? 0,
  });
  if (error) throw new Error(error.message);

  await recomputeQuoteTotal(input.repairOrderId);
  revalidatePath(`/atelier/${input.repairOrderId}`);
}

export async function removeRepairOrderItem(itemId: string, repairOrderId: string) {
  const { supabase } = await getProfile();
  const { error } = await supabase.from('repair_order_items').delete().eq('id', itemId);
  if (error) throw new Error(error.message);
  await recomputeQuoteTotal(repairOrderId);
  revalidatePath(`/atelier/${repairOrderId}`);
}

async function recomputeQuoteTotal(repairOrderId: string) {
  const { supabase } = await getProfile();
  const { data: items } = await supabase
    .from('repair_order_items')
    .select('quantity, unit_price')
    .eq('repair_order_id', repairOrderId);
  const total = (items ?? []).reduce((sum, i) => sum + Number(i.quantity) * Number(i.unit_price), 0);
  await supabase.from('repair_orders').update({ quote_total: total }).eq('id', repairOrderId);
}

// ---------- Devis : validation = réservation automatique des pièces (cahier des charges, Module 4) ----------
// Les mouvements de stock de pièces passent par la fonction SQL
// apply_repair_order_parts (migration 0028) : un technicien ou la secrétaire
// n'ont pas le droit d'écrire directement dans "parts", et la mise à jour
// échouait en silence. Les fonctions renvoient { error } au lieu de lever
// une erreur, pour que le message ("Stock insuffisant...") s'affiche aussi
// en production.
export async function validateQuote(repairOrderId: string): Promise<{ error?: string }> {
  const { supabase } = await getProfile();

  const { error: stockError } = await supabase.rpc('apply_repair_order_parts', {
    p_repair_order_id: repairOrderId,
    p_action: 'reserver',
  });
  if (stockError) return { error: stockError.message };

  const { error } = await supabase
    .from('repair_orders')
    .update({ quote_status: 'valide', quote_validated_at: new Date().toISOString(), status: 'en_cours' })
    .eq('id', repairOrderId);
  if (error) return { error: error.message };

  revalidatePath(`/atelier/${repairOrderId}`);
  return {};
}

export async function refuseQuote(repairOrderId: string) {
  const { supabase } = await getProfile();
  await supabase.from('repair_orders').update({ quote_status: 'refuse', status: 'annule' }).eq('id', repairOrderId);
  revalidatePath(`/atelier/${repairOrderId}`);
}

// ---------- Changement de statut (termine/facture = consommation des pièces réservées) ----------
export async function updateRepairOrderStatus(
  repairOrderId: string,
  status: 'ouvert' | 'en_cours' | 'en_attente_pieces' | 'termine' | 'facture' | 'annule'
): Promise<{ error?: string }> {
  const { supabase } = await getProfile();

  const { data: order } = await supabase
    .from('repair_orders')
    .select('quote_status, status')
    .eq('id', repairOrderId)
    .single();

  // Terminé : les pièces de l'OR sortent du stock (et de la réservation).
  if (status === 'termine' && order?.status !== 'termine') {
    const { error } = await supabase.rpc('apply_repair_order_parts', {
      p_repair_order_id: repairOrderId,
      p_action: 'consommer',
    });
    if (error) return { error: error.message };
  }

  // Annulé après validation du devis : les pièces réservées sont libérées.
  if (status === 'annule' && order?.quote_status === 'valide' && order?.status !== 'termine') {
    const { error } = await supabase.rpc('apply_repair_order_parts', {
      p_repair_order_id: repairOrderId,
      p_action: 'liberer',
    });
    if (error) return { error: error.message };
  }

  const update: Record<string, unknown> = { status };
  if (status === 'termine') update.closed_at = new Date().toISOString();
  const { error } = await supabase.from('repair_orders').update(update).eq('id', repairOrderId);
  if (error) return { error: error.message };

  revalidatePath('/atelier');
  revalidatePath(`/atelier/${repairOrderId}`);
  return {};
}

// ---------- Facturation de l'OR (Module 5 : référence liée = N° d'OR) ----------
export async function invoiceRepairOrder(repairOrderId: string) {
  const { supabase, organization_id, userId } = await getProfile();

  const { data: order, error: orderError } = await supabase
    .from('repair_orders')
    .select('id, order_number, client_id, document_id')
    .eq('id', repairOrderId)
    .single();
  if (orderError) throw new Error(orderError.message);
  if (!order) throw new Error('Ordre de réparation introuvable');
  if (order.document_id) throw new Error('Cet ordre de réparation a déjà une facture.');
  if (!order.client_id) throw new Error("Impossible de facturer : aucun client n'est associé à cet ordre.");

  const { data: items, error: itemsError } = await supabase
    .from('repair_order_items')
    .select('designation, quantity, unit_price')
    .eq('repair_order_id', repairOrderId)
    .order('position');
  if (itemsError) throw new Error(itemsError.message);
  if (!items || items.length === 0) throw new Error('Ajoutez au moins une ligne (main d’œuvre ou pièce) avant de facturer.');

  const subtotal = items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unit_price), 0);
  const taxRate = 18;
  const taxAmount = subtotal * (taxRate / 100);
  const totalAmount = subtotal + taxAmount;

  const year = new Date().getFullYear();
  const issueDate = new Date();
  const dueDate = new Date(issueDate);
  dueDate.setMonth(dueDate.getMonth() + 1);

  const { data: documentNumber, error: numberError } = await supabase.rpc('get_next_document_number', {
    p_organization_id: organization_id,
    p_document_type: 'facture',
    p_year: year,
  });
  if (numberError) throw new Error(numberError.message);

  const { data: document, error: documentError } = await supabase
    .from('documents')
    .insert({
      organization_id,
      document_type: 'facture',
      document_number: documentNumber,
      status: 'brouillon',
      client_id: order.client_id,
      commercial_id: userId,
      issue_date: issueDate.toISOString().slice(0, 10),
      due_date: dueDate.toISOString().slice(0, 10),
      subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      notes: `Facturation de l'ordre de réparation ${order.order_number}`,
    })
    .select('id')
    .single();
  if (documentError) throw new Error(documentError.message);

  const itemRows = items.map((item, index) => ({
    document_id: document.id,
    designation: item.designation,
    quantity: item.quantity,
    unit_price: item.unit_price,
    tax_rate: taxRate,
    discount_percent: 0,
    position: index,
  }));
  const { error: lineError } = await supabase.from('document_items').insert(itemRows);
  if (lineError) throw new Error(lineError.message);

  await supabase.from('repair_orders').update({ document_id: document.id, status: 'facture' }).eq('id', repairOrderId);

  revalidatePath(`/atelier/${repairOrderId}`);
  return { documentId: document.id as string };
}

export async function getClientOptions() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('clients')
    .select('id, first_name, last_name, company_name, phone')
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    id: c.id,
    label: [c.company_name, [c.first_name, c.last_name].filter(Boolean).join(' '), c.phone].filter(Boolean).join(' · '),
  }));
}

export async function searchVehicleOptionsForClient(clientId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sale_contracts')
    .select('id, products(designation, brand, model)')
    .eq('client_id', clientId)
    .eq('status', 'signe');
  if (error) throw new Error(error.message);
  return data ?? [];
}
