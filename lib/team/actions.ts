'use server';

// Vue globale pour les super_admin / administrateur : pouvoir suivre
// l'activité de chaque commercial (clients, prospects, documents, contrats,
// chiffre d'affaires) sans avoir à interroger chaque module séparément.
//
// Important : les données elles-mêmes sont déjà visibles par un admin grâce
// aux policies RLS existantes (clients_select / documents_select / etc.
// laissent 'super_admin' et 'administrateur' voir toute l'organisation, pas
// seulement leurs propres lignes) -- il manquait seulement une page pour les
// regrouper par commercial. Ce fichier ne contourne donc aucune règle de
// sécurité : il se contente d'agréger ce que l'admin peut déjà lire.

import { createClient } from '@/lib/supabase/server';

async function requireManagerAccess() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifié');

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, organization_id, role')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile) throw new Error('Profil introuvable');
  if (!['super_admin', 'administrateur'].includes(profile.role)) {
    throw new Error("Vous n'avez pas les droits pour consulter l'activité de l'équipe.");
  }
  return profile;
}

export interface TeamMemberOverview {
  id: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  clients_count: number;
  prospects_actifs_count: number;
  documents_count: number;
  contracts_count: number;
  revenue_month: number;
  unpaid_total: number;
  last_activity_at: string | null;
}

export async function getTeamOverview(): Promise<TeamMemberOverview[]> {
  const profile = await requireManagerAccess();
  const supabase = await createClient();

  const { data: members, error: membersError } = await supabase
    .from('profiles')
    .select('id, full_name, role, is_active')
    .eq('organization_id', profile.organization_id)
    .order('full_name');
  if (membersError) throw new Error(membersError.message);
  if (!members || members.length === 0) return [];

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const startOfMonthIso = startOfMonth.toISOString().slice(0, 10);

  const [
    { data: clients },
    { data: prospects },
    { data: documents },
    { data: contracts },
  ] = await Promise.all([
    supabase.from('clients').select('assigned_to').eq('organization_id', profile.organization_id),
    supabase
      .from('prospects')
      .select('assigned_to, status')
      .eq('organization_id', profile.organization_id)
      .not('status', 'in', '(converti,perdu)'),
    supabase
      .from('documents')
      .select('commercial_id, document_type, status, total_amount, balance_due, issue_date, created_at')
      .eq('organization_id', profile.organization_id),
    supabase
      .from('sale_contracts')
      .select('commercial_id, created_at')
      .eq('organization_id', profile.organization_id),
  ]);

  return members.map((m) => {
    const memberDocs = (documents ?? []).filter((d) => d.commercial_id === m.id);
    const revenueMonth = memberDocs
      .filter(
        (d) =>
          d.document_type === 'facture' &&
          (d.status === 'paye' || d.status === 'paye_partiel') &&
          d.issue_date >= startOfMonthIso
      )
      .reduce((sum, d) => sum + Number(d.total_amount || 0), 0);
    const unpaidTotal = memberDocs
      .filter((d) => ['envoye', 'paye_partiel'].includes(d.status ?? ''))
      .reduce((sum, d) => sum + Number(d.balance_due || 0), 0);

    const activityDates = [
      ...memberDocs.map((d) => d.created_at),
      ...(contracts ?? []).filter((c) => c.commercial_id === m.id).map((c) => c.created_at),
    ].filter(Boolean) as string[];
    const lastActivity = activityDates.length
      ? activityDates.reduce((latest, d) => (d > latest ? d : latest))
      : null;

    return {
      id: m.id,
      full_name: m.full_name,
      role: m.role,
      is_active: m.is_active,
      clients_count: (clients ?? []).filter((c) => c.assigned_to === m.id).length,
      prospects_actifs_count: (prospects ?? []).filter((p) => p.assigned_to === m.id).length,
      documents_count: memberDocs.length,
      contracts_count: (contracts ?? []).filter((c) => c.commercial_id === m.id).length,
      revenue_month: revenueMonth,
      unpaid_total: unpaidTotal,
      last_activity_at: lastActivity,
    };
  });
}

export interface CommercialDetail {
  profile: { id: string; full_name: string | null; role: string; email: string | null; phone: string | null };
  clients: { id: string; first_name: string | null; last_name: string | null; company_name: string | null; phone: string | null }[];
  prospects: { id: string; first_name: string | null; last_name: string | null; status: string; next_relance_at: string | null }[];
  documents: {
    id: string;
    document_type: string;
    document_number: string | null;
    status: string | null;
    total_amount: number;
    issue_date: string;
  }[];
  contracts: { id: string; contract_number: string | null; status: string; sale_price: number; created_at: string }[];
}

export async function getCommercialDetail(userId: string): Promise<CommercialDetail> {
  const profile = await requireManagerAccess();
  const supabase = await createClient();

  const { data: member, error: memberError } = await supabase
    .from('profiles')
    .select('id, full_name, role, email, phone')
    .eq('id', userId)
    .eq('organization_id', profile.organization_id)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!member) throw new Error('Utilisateur introuvable');

  const [{ data: clients }, { data: prospects }, { data: documents }, { data: contracts }] = await Promise.all([
    supabase
      .from('clients')
      .select('id, first_name, last_name, company_name, phone')
      .eq('organization_id', profile.organization_id)
      .eq('assigned_to', userId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('prospects')
      .select('id, first_name, last_name, status, next_relance_at')
      .eq('organization_id', profile.organization_id)
      .eq('assigned_to', userId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('documents')
      .select('id, document_type, document_number, status, total_amount, issue_date')
      .eq('organization_id', profile.organization_id)
      .eq('commercial_id', userId)
      .order('issue_date', { ascending: false })
      .limit(100),
    supabase
      .from('sale_contracts')
      .select('id, contract_number, status, sale_price, created_at')
      .eq('organization_id', profile.organization_id)
      .eq('commercial_id', userId)
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  return {
    profile: member,
    clients: clients ?? [],
    prospects: prospects ?? [],
    documents: documents ?? [],
    contracts: contracts ?? [],
  };
}
