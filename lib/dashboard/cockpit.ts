// Données du tableau de bord « cockpit » (maquette du 13/10/2026). Tout vient
// de la base : aucun chiffre n'est inventé. Les calculs de période se font
// dans le fuseau de Lomé (UTC+0, sans heure d'été).
import { createClient } from '@/lib/supabase/server';
import { getAgenda } from '@/lib/crm/agenda';
import { daysInStock } from '@/lib/stock/labels';
import { clientDisplayName } from '@/lib/documents/labels';
import { canSeeCommercial } from '@/lib/navigation';

const TZ = 'Africa/Lome';
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export type FleetStatus = 'disponible' | 'reserve' | 'demo' | 'essai' | 'endommage';

export const FLEET_STATUS: Record<FleetStatus, { label: string; badge: string }> = {
  disponible: { label: 'Disponible', badge: 'badge-green' },
  reserve: { label: 'Réservé, acompte', badge: 'badge-amber' },
  demo: { label: 'Plaque démo', badge: 'badge-blue' },
  essai: { label: 'Essais', badge: 'badge-violet' },
  endommage: { label: 'Endommagé', badge: 'badge-red' },
};

export type FleetVehicle = {
  id: string;
  model: string;
  detail: string;
  vin: string;
  colorHex: string;
  bodyType: 'suv' | 'pickup';
  status: FleetStatus;
  days: number;
};

export type TodoRow = {
  key: string;
  count: number;
  tone: 'r' | 'a' | 'n' | 'g';
  title: string;
  detail: string;
  href: string;
};

export type SaleStage = 0 | 1 | 2 | 3; // proforma, commande, facture, payé

export type SaleInProgress = {
  id: string;
  client: string;
  vehicle: string | null;
  commercial: string | null;
  amount: number;
  stage: SaleStage;
  late: boolean;
  label: string;
  href: string;
};

export type CockpitData = {
  firstName: string;
  dateLabel: string;
  monthName: string;
  prevMonthName: string;
  role: string;
  commercialSide: boolean;
  canSetTarget: boolean;
  target: number;
  invoiced: number;
  targetPct: number | null;
  workingDaysLeft: number;
  ordersToInvoice: number;
  collected: number;
  collectedPrev: number;
  unpaidTotal: number;
  unpaidCount: number;
  overdueCount: number;
  oldestOverdueDays: number;
  leadsMonth: number;
  leadsPrev: number;
  hotDeals: number;
  fleet: FleetVehicle[];
  todo: TodoRow[];
  sales: SaleInProgress[];
};

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
const COLOR_HEX: [RegExp, string][] = [
  [/blanc|white|nacr/i, '#F1F2EE'],
  [/noir|black/i, '#1C222B'],
  [/argent|silver|gris clair/i, '#C9D3E0'],
  [/gris|grey|gray|anthracite|titan/i, '#5B6573'],
  [/rouge|red|bordeaux/i, '#7A1C22'],
  [/bleu|blue|marine/i, '#2357A6'],
  [/vert|green|kaki/i, '#3F5A3A'],
  [/beige|sable|champagne|\bor\b|gold/i, '#C8B48C'],
  [/marron|brun|brown|bronze/i, '#5E4433'],
  [/orange/i, '#C25E22'],
  [/jaune|yellow/i, '#C9A227'],
];

export function colorToHex(color: string | null | undefined) {
  if (!color) return '#46536A';
  for (const [re, hex] of COLOR_HEX) if (re.test(color)) return hex;
  return '#46536A';
}

// « CHERY TIGGO 2 PRO BOÎTE MANUELLE » -> « Tiggo 2 Pro » + « boîte manuelle »
export function shortModel(designation: string) {
  const base = designation.split('\n')[0].replace(/^CHERY\s+/i, '').trim();
  const [name, ...rest] = base.split(/\s+(?=BO[IÎ]TE\b)/i);
  const title = name
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (/^\d+x\d+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
  return { name: title, transmission: rest.join(' ').toLowerCase() || null };
}

function lomeToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

// Jours ouvrés (lundi à vendredi) restants dans le mois, aujourd'hui compris.
export function workingDaysLeft(todayIso: string) {
  const [y, m, d] = todayIso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let n = 0;
  for (let day = d; day <= last; day++) {
    const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

function prevMonthSamePeriod(todayIso: string) {
  const [y, m, d] = todayIso.split('-').map(Number);
  const lastPrev = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const start = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m - 2, Math.min(d, lastPrev))).toISOString().slice(0, 10);
  return { start, end };
}

function shortPerson(fullName: string | null | undefined) {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  // Le nom de famille est souvent saisi en majuscules (« ATITSO Yawa »).
  const surname = parts.find((w) => w.length > 1 && w === w.toUpperCase() && /\p{L}/u.test(w)) ?? parts[parts.length - 1];
  const given = parts.find((w) => w !== surname) ?? '';
  const cap = surname.charAt(0).toUpperCase() + surname.slice(1).toLowerCase();
  return given ? `${given.charAt(0).toUpperCase()}. ${cap}` : cap;
}

function money(n: number) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n)).replace(/[  ]/g, ' ');
}

type ClientRel = { first_name: string | null; last_name: string | null; company_name: string | null };
type DocRow = {
  id: string;
  document_type: string;
  status: string;
  parent_document_id: string | null;
  total_amount: number;
  balance_due: number;
  due_date: string | null;
  updated_at: string;
  clients: ClientRel | ClientRel[] | null;
  commercial: { full_name: string | null } | { full_name: string | null }[] | null;
};

const STAGE_OF: Record<string, SaleStage> = { devis: 0, proforma: 0, commande: 1, facture: 2 };
const STAGE_LABEL = ['Proforma', 'Commande', 'Facture', 'Payé'];
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

// ---------------------------------------------------------------------------
export async function loadCockpit(): Promise<CockpitData> {
  const supabase = await createClient();
  const today = lomeToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const prev = prevMonthSamePeriod(today);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('full_name, role').eq('id', user?.id ?? '').maybeSingle();
  const role = (profile?.role as string | undefined) ?? '';
  const commercialSide = canSeeCommercial(role) || ['responsable_showroom', 'vendeur_showroom'].includes(role);
  const billing = ['super_admin', 'administrateur', 'manager', 'admin_ventes'].includes(role);
  const seesAllAgenda = ['super_admin', 'administrateur', 'manager', 'admin_ventes', 'chef_service'].includes(role);
  const seesParts = ['super_admin', 'administrateur', 'manager', 'magasinier', 'chef_atelier'].includes(role);

  const [
    progressRes,
    ordersRes,
    paymentsRes,
    unpaidRes,
    leadsRes,
    hotRes,
    unitsRes,
    productsRes,
    docsRes,
    staleRes,
    partsRes,
    agendaRes,
  ] = await Promise.all([
    supabase.rpc('monthly_target_progress'),
    supabase.from('documents').select('id', { count: 'exact', head: true }).eq('document_type', 'commande').not('status', 'in', '(accepte,annule)'),
    supabase.from('payments').select('amount, payment_date').gte('payment_date', prev.start),
    supabase
      .from('documents')
      .select('id, document_number, balance_due, due_date')
      .eq('document_type', 'facture')
      .gt('balance_due', 0)
      .not('status', 'in', '(paye,annule)'),
    supabase.from('prospects').select('created_at').gte('created_at', `${prev.start}T00:00:00Z`),
    supabase.from('deals').select('id', { count: 'exact', head: true }).eq('temperature', 'chaude').in('stage', ['decouverte', 'proforma', 'negociation', 'commande']),
    supabase.rpc('list_vehicle_units'),
    supabase.from('products').select('id, body_type'),
    supabase
      .from('documents')
      .select(
        'id, document_type, status, parent_document_id, total_amount, balance_due, due_date, updated_at, clients(first_name, last_name, company_name), commercial:profiles!documents_commercial_id_fkey(full_name)'
      )
      .in('document_type', ['devis', 'proforma', 'commande', 'facture'])
      .not('status', 'in', '(annule,refuse)')
      .gte('updated_at', thirtyDaysAgo)
      .order('updated_at', { ascending: false })
      .limit(200),
    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .in('document_type', ['devis', 'proforma'])
      .eq('status', 'envoye')
      .lt('issue_date', sevenDaysAgo),
    seesParts
      ? supabase.from('parts').select('id', { count: 'exact', head: true }).eq('is_active', false)
      : Promise.resolve({ count: 0 }),
    getAgenda(today, today, seesAllAgenda ? null : user?.id ?? null),
  ]);

  // Objectif (toute l'organisation).
  const progress = (progressRes.data ?? {}) as { target?: number; invoiced?: number };
  const target = Number(progress.target ?? 0);
  const invoiced = Number(progress.invoiced ?? 0);
  const targetPct = target > 0 ? Math.round((invoiced / target) * 100) : null;

  // Encaissements.
  const payments = (paymentsRes.data ?? []) as { amount: number; payment_date: string }[];
  const collected = payments.filter((p) => p.payment_date >= monthStart).reduce((s, p) => s + Number(p.amount), 0);
  const collectedPrev = payments
    .filter((p) => p.payment_date >= prev.start && p.payment_date <= prev.end)
    .reduce((s, p) => s + Number(p.amount), 0);

  // Reste à encaisser.
  const unpaid = (unpaidRes.data ?? []) as { id: string; document_number: string | null; balance_due: number; due_date: string | null }[];
  const unpaidTotal = unpaid.reduce((s, d) => s + Number(d.balance_due), 0);
  const overdue = unpaid.filter((d) => d.due_date && d.due_date < today);
  const daysLate = (due: string) => Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
  const oldestOverdueDays = overdue.reduce((m, d) => Math.max(m, daysLate(d.due_date as string)), 0);

  // Leads.
  const leadDays = ((leadsRes.data ?? []) as { created_at: string }[]).map((l) =>
    new Date(l.created_at).toLocaleDateString('en-CA', { timeZone: TZ })
  );
  const leadsMonth = leadDays.filter((d) => d >= monthStart).length;
  const leadsPrev = leadDays.filter((d) => d >= prev.start && d <= prev.end).length;

  // Le parc.
  const bodyOf = new Map(((productsRes.data ?? []) as { id: string; body_type: string | null }[]).map((p) => [p.id, p.body_type]));
  type UnitRow = { id: string; product_id: string; model: string; vin: string; color: string | null; entry_date: string; status: string };
  const fleet: FleetVehicle[] = ((unitsRes.data ?? []) as UnitRow[])
    .filter((u) => u.status !== 'vendu')
    .map((u) => {
      const m = shortModel(u.model);
      return {
        id: u.id,
        model: m.name,
        detail: [u.color, m.transmission].filter(Boolean).join(', ') || u.vin,
        vin: u.vin,
        colorHex: colorToHex(u.color),
        bodyType: bodyOf.get(u.product_id) === 'pickup' ? ('pickup' as const) : ('suv' as const),
        status: (u.status in FLEET_STATUS ? u.status : 'disponible') as FleetStatus,
        days: daysInStock(u.entry_date),
      };
    })
    .sort((a, b) => b.days - a.days);

  // Ventes en cours : dernière étape atteinte de chaque vente (30 derniers jours).
  const docs = (docsRes.data ?? []) as DocRow[];
  const advanced = new Set<string>();
  for (const d of docs) if (d.parent_document_id && STAGE_OF[d.document_type] !== undefined) advanced.add(d.parent_document_id);
  const salesDocs = docs
    .filter((d) => {
      const stage = STAGE_OF[d.document_type];
      if (stage === undefined) return false;
      if (stage < 2 && (advanced.has(d.id) || d.status === 'accepte')) return false;
      return true;
    })
    .slice(0, 6);
  const { data: firstItems } = salesDocs.length
    ? await supabase
        .from('document_items')
        .select('document_id, designation, position')
        .in('document_id', salesDocs.map((d) => d.id))
        .order('position', { ascending: true })
    : { data: [] as { document_id: string; designation: string; position: number }[] };
  const vehicleOf = new Map<string, string>();
  for (const it of (firstItems ?? []) as { document_id: string; designation: string }[]) {
    if (!vehicleOf.has(it.document_id)) vehicleOf.set(it.document_id, shortModel(it.designation).name);
  }
  const sales: SaleInProgress[] = salesDocs.map((d) => {
    const paid = d.document_type === 'facture' && d.status === 'paye';
    const stage = (paid ? 3 : STAGE_OF[d.document_type]) as SaleStage;
    const pastDue = !!d.due_date && d.due_date < today;
    const late = !paid && pastDue && (stage === 0 || (stage === 2 && Number(d.balance_due) > 0));
    const label = late ? (stage === 0 ? 'Proforma expirée' : 'Facture en retard') : STAGE_LABEL[stage];
    return {
      id: d.id,
      client: clientDisplayName(one(d.clients)),
      vehicle: vehicleOf.get(d.id) ?? null,
      commercial: shortPerson(one(d.commercial)?.full_name),
      amount: Number(d.total_amount),
      stage,
      late,
      label,
      href: `/documents/${d.id}`,
    };
  });

  // À faire aujourd'hui (seulement ce qui existe vraiment).
  const todo: TodoRow[] = [];
  if (overdue.length > 0) {
    const first = overdue[0];
    todo.push({
      key: 'retard',
      count: overdue.length,
      tone: 'r',
      title: overdue.length > 1 ? 'Factures en retard' : `Facture en retard de ${daysLate(first.due_date as string)} jours`,
      detail:
        overdue.length > 1
          ? `${money(overdue.reduce((s, d) => s + Number(d.balance_due), 0))} FCFA à relancer`
          : `${first.document_number ?? 'Facture'}, ${money(Number(first.balance_due))} FCFA à relancer`,
      href: overdue.length > 1 ? '/impayes' : `/documents/${first.id}`,
    });
  }
  const ordersToInvoice = ordersRes.count ?? 0;
  if (ordersToInvoice > 0) {
    todo.push({
      key: 'commandes',
      count: ordersToInvoice,
      tone: billing ? 'a' : 'g',
      title: billing ? 'Commandes à facturer' : 'Commandes en attente de facture',
      detail: billing ? 'Validées par les commerciaux' : "Chez l'administration des ventes",
      href: '/documents?type=commande&statut=brouillon',
    });
  }
  const agendaToday = agendaRes.items.filter((i) => i.status === 'prevu');
  if (agendaToday.length > 0) {
    const first = agendaToday[0];
    const time = first.source === 'relance_lead' ? '' : `${new Date(first.starts_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })}, `;
    todo.push({
      key: 'agenda',
      count: agendaToday.length,
      tone: 'n',
      title: agendaToday.length > 1 ? 'Rendez-vous et relances du jour' : 'Rendez-vous ou relance du jour',
      detail: `${time}${first.title}${first.contact_name ? `, ${first.contact_name}` : ''}`,
      href: '/agenda',
    });
  }
  const stale = staleRes.count ?? 0;
  if (stale > 0) {
    todo.push({
      key: 'proformas',
      count: stale,
      tone: 'n',
      title: 'Proformas sans réponse',
      detail: 'Envoyées il y a plus de 7 jours',
      href: '/documents?type=devis&statut=envoye',
    });
  }
  const sleeping = fleet.filter((v) => v.days > 90).length;
  if (sleeping > 0) {
    todo.push({
      key: 'parc',
      count: sleeping,
      tone: 'a',
      title: 'Véhicules en stock depuis plus de 90 jours',
      detail: 'À pousser en priorité',
      href: '/stock',
    });
  }
  const partsToActivate = (partsRes as { count: number | null }).count ?? 0;
  if (partsToActivate > 0) {
    todo.push({
      key: 'pieces',
      count: partsToActivate,
      tone: 'g',
      title: 'Pièces sans prix de vente',
      detail: 'Importées, à activer',
      href: '/pieces',
    });
  }

  const [y, m, d] = today.split('-').map(Number);
  const dateLabel = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return {
    firstName: ((profile?.full_name as string | undefined) ?? '').split(' ')[0] ?? '',
    dateLabel: dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1),
    monthName: MONTHS[m - 1],
    prevMonthName: MONTHS[(m + 10) % 12],
    role,
    commercialSide,
    canSetTarget: ['super_admin', 'administrateur', 'manager'].includes(role),
    target,
    invoiced,
    targetPct,
    workingDaysLeft: workingDaysLeft(today),
    ordersToInvoice,
    collected,
    collectedPrev,
    unpaidTotal,
    unpaidCount: unpaid.length,
    overdueCount: overdue.length,
    oldestOverdueDays,
    leadsMonth,
    leadsPrev,
    hotDeals: hotRes.count ?? 0,
    fleet,
    todo,
    sales,
  };
}

const NUMBERS = ['Zéro', 'Une', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six', 'Sept', 'Huit', 'Neuf', 'Dix'];

// Phrase de synthèse du bandeau, construite uniquement à partir des données.
export function cockpitSummary(d: CockpitData) {
  const month = d.monthName.charAt(0).toUpperCase() + d.monthName.slice(1);
  const days = `${d.workingDaysLeft} jour${d.workingDaysLeft > 1 ? 's' : ''} ouvré${d.workingDaysLeft > 1 ? 's' : ''} restant${d.workingDaysLeft > 1 ? 's' : ''}`;
  const first =
    d.targetPct !== null
      ? `${month} est à ${d.targetPct} % de l'objectif, avec ${days}.`
      : `${days.charAt(0).toUpperCase()}${days.slice(1)} en ${d.monthName}.${d.canSetTarget ? " L'objectif mensuel n'est pas encore fixé." : ''}`;
  let second = '';
  if (d.ordersToInvoice > 0) {
    const n = d.ordersToInvoice <= 10 ? NUMBERS[d.ordersToInvoice] : String(d.ordersToInvoice);
    second =
      d.ordersToInvoice > 1 ? ` ${n} commandes attendent leur facture.` : ` ${n} commande attend sa facture.`;
  }
  return first + second;
}
