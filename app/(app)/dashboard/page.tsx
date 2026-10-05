import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PendingDocumentsWidget } from '@/components/offline/pending-documents-widget';
import { MfaNudgeBanner } from '@/components/security/mfa-nudge-banner';
import { IconCash, IconAlert, IconDocument, IconUsers, IconPlus, IconCar, IconWrench, IconBox, IconShield } from '@/components/icons';
import {
  KpiCard,
  RevenueChart,
  TaskList,
  RecentDocuments,
  RepairOrdersCard,
  StockSummary,
  formatAmount,
  type TaskItem,
  type RecentDocument,
} from '@/components/dashboard/widgets';
import { canSeeCommercial } from '@/lib/navigation';
import { clientDisplayName } from '@/lib/documents/labels';

// Fuseau du Togo (UTC+0, sans heure d'été) : les dates "du mois" doivent
// correspondre au calendrier de Lomé, pas à celui du serveur Vercel.
const TZ = 'Africa/Lome';

function monthStart(offset: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

type ClientRel = { first_name: string | null; last_name: string | null; company_name: string | null };

export default async function DashboardPage() {
  const supabase = await createClient();

  // Filtre explicite par id : pour un admin, la RLS renvoie tous les profils
  // de l'organisation, et .single() plantait silencieusement (bug du 26/09).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user?.id ?? '')
    .maybeSingle();

  const role = profile?.role ?? null;
  const isCommercialSide = canSeeCommercial(role);
  // Le responsable showroom ne voit jamais les dossiers des commerciaux
  // (exigence du DG, 04/10) : la RLS ne lui renvoie que ses propres
  // documents/clients, et ce tableau de bord ne lui montre aucun indicateur
  // commercial global.
  const isShowroom = role === 'responsable_showroom';
  const isSuperAdmin = role === 'super_admin';
  const canOpenRepairOrder = ['super_admin', 'administrateur', 'manager', 'receptionniste_sav', 'chef_atelier', 'responsable_showroom'].includes(
    role ?? ''
  );

  const today = isoDate(new Date());
  const currentMonth = monthStart(0);
  const previousMonth = monthStart(-1);
  const sixMonthsAgo = monthStart(-5);

  const empty = { data: null, count: 0 };

  const [
    paymentsRes,
    unpaidRes,
    monthInvoicesRes,
    draftsRes,
    awaitingRes,
    clientsRes,
    prospectsRes,
    recentDocsRes,
    openOrdersRes,
    partsRes,
    productsRes,
    warrantiesRes,
  ] = await Promise.all([
    isCommercialSide
      ? supabase.from('payments').select('amount, payment_date').gte('payment_date', isoDate(sixMonthsAgo))
      : empty,
    isCommercialSide
      ? supabase
          .from('documents')
          .select('balance_due, due_date')
          .eq('document_type', 'facture')
          .gt('balance_due', 0)
          .not('status', 'in', '(paye,annule)')
      : empty,
    isCommercialSide
      ? supabase
          .from('documents')
          .select('total_amount, status')
          .eq('document_type', 'facture')
          .neq('status', 'annule')
          .gte('issue_date', isoDate(currentMonth))
      : empty,
    isCommercialSide
      ? supabase.from('documents').select('*', { count: 'exact', head: true }).eq('status', 'brouillon')
      : empty,
    isCommercialSide
      ? supabase
          .from('documents')
          .select('*', { count: 'exact', head: true })
          .in('document_type', ['devis', 'proforma'])
          .eq('status', 'envoye')
      : empty,
    isCommercialSide || isShowroom ? supabase.from('clients').select('*', { count: 'exact', head: true }) : empty,
    isCommercialSide
      ? supabase.from('prospects').select('*', { count: 'exact', head: true }).not('status', 'in', '(converti,perdu)')
      : empty,
    isCommercialSide || isShowroom
      ? supabase
          .from('documents')
          .select('id, document_number, document_type, status, issue_date, total_amount, clients(first_name, last_name, company_name)')
          .order('created_at', { ascending: false })
          .limit(6)
      : empty,
    supabase
      .from('repair_orders')
      .select('id, order_number, vehicle_label, vehicle_plate, status, opened_at', { count: 'exact' })
      .in('status', ['ouvert', 'en_cours', 'en_attente_pieces'])
      .order('opened_at', { ascending: false })
      .limit(5),
    supabase.from('parts').select('quantity_on_hand, quantity_reserved, stock_min, is_active'),
    supabase.from('products').select('quantity_on_hand, stock_min').eq('is_active', true),
    supabase.from('vehicle_warranties').select('*', { count: 'exact', head: true }),
  ]);

  // ---------- Encaissements (6 derniers mois) ----------
  const payments = (paymentsRes.data ?? []) as { amount: number; payment_date: string }[];
  const byMonth = new Map<string, number>();
  for (const p of payments) {
    if (!p.payment_date) continue;
    const key = monthKey(p.payment_date);
    byMonth.set(key, (byMonth.get(key) ?? 0) + Number(p.amount));
  }
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = monthStart(i - 5);
    const key = isoDate(d).slice(0, 7);
    return {
      label: d.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' }).replace('.', ''),
      amount: byMonth.get(key) ?? 0,
      current: i === 5,
    };
  });
  const collectedThisMonth = byMonth.get(isoDate(currentMonth).slice(0, 7)) ?? 0;
  const collectedLastMonth = byMonth.get(isoDate(previousMonth).slice(0, 7)) ?? 0;
  const previousMonthName = previousMonth.toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });

  let collectedHint = `Aucun encaissement en ${previousMonthName}`;
  let collectedTone: 'green' | 'red' | 'gray' = 'gray';
  if (collectedLastMonth > 0) {
    const delta = Math.round(((collectedThisMonth - collectedLastMonth) / collectedLastMonth) * 100);
    collectedHint = `${delta >= 0 ? '+' : ''}${delta} % par rapport à ${previousMonthName}`;
    collectedTone = delta >= 0 ? 'green' : 'red';
  }

  // ---------- Impayés ----------
  const unpaid = (unpaidRes.data ?? []) as { balance_due: number; due_date: string | null }[];
  const totalUnpaid = unpaid.reduce((s, d) => s + Number(d.balance_due), 0);
  const overdueCount = unpaid.filter((d) => d.due_date && d.due_date < today).length;

  // ---------- Facturation du mois ----------
  const monthInvoices = (monthInvoicesRes.data ?? []) as { total_amount: number }[];
  const invoicedThisMonth = monthInvoices.reduce((s, d) => s + Number(d.total_amount), 0);

  // ---------- Stock ----------
  const parts = (partsRes.data ?? []) as {
    quantity_on_hand: number;
    quantity_reserved: number;
    stock_min: number;
    is_active: boolean;
  }[];
  const activeParts = parts.filter((p) => p.is_active);
  const lowParts = activeParts.filter(
    (p) => Number(p.quantity_on_hand) - Number(p.quantity_reserved) <= Number(p.stock_min)
  ).length;
  const partsToActivate = parts.length - activeParts.length;

  const products = (productsRes.data ?? []) as { quantity_on_hand: number; stock_min: number }[];
  const vehiclesInStock = products.reduce((s, p) => s + Math.max(0, Number(p.quantity_on_hand)), 0);
  const lowVehicles = products.filter((p) => Number(p.quantity_on_hand) <= Number(p.stock_min)).length;

  // ---------- Atelier ----------
  const openOrders = ((openOrdersRes.data ?? []) as {
    id: string;
    order_number: string | null;
    vehicle_label: string | null;
    vehicle_plate: string | null;
    status: string;
    opened_at: string | null;
  }[]).map((o) => ({
    id: o.id,
    number: o.order_number,
    vehicle: [o.vehicle_label, o.vehicle_plate].filter(Boolean).join(' · ') || 'Véhicule non renseigné',
    status: o.status,
    openedAt: o.opened_at,
  }));
  const openOrdersCount = openOrdersRes.count ?? openOrders.length;

  // ---------- Derniers documents ----------
  const recentDocuments: RecentDocument[] = ((recentDocsRes.data ?? []) as {
    id: string;
    document_number: string | null;
    document_type: string;
    status: string;
    issue_date: string | null;
    total_amount: number;
    clients: ClientRel | ClientRel[] | null;
  }[]).map((d) => ({
    id: d.id,
    number: d.document_number,
    type: d.document_type,
    status: d.status,
    client: clientDisplayName(Array.isArray(d.clients) ? d.clients[0] : d.clients),
    date: d.issue_date,
    total: Number(d.total_amount),
  }));

  // ---------- Liste "À traiter" ----------
  const stockTasks: TaskItem[] = [
    {
      label: 'Pièces sous le seuil',
      description: 'Stock disponible inférieur ou égal au minimum',
      count: lowParts,
      href: '/pieces',
      tone: 'red',
    },
  ];
  if (isSuperAdmin) {
    stockTasks.push({
      label: 'Pièces à activer',
      description: 'Importées, en attente de prix de vente',
      count: partsToActivate,
      href: '/pieces',
      tone: 'orange',
    });
  }

  const commercialTasks: TaskItem[] = [
    {
      label: 'Factures en retard',
      description: "Échéance dépassée, solde restant dû",
      count: overdueCount,
      href: '/impayes',
      tone: 'red',
    },
    {
      label: 'Devis et proformas envoyés',
      description: 'En attente de réponse du client',
      count: awaitingRes.count ?? 0,
      href: '/documents?status=envoye',
      tone: 'orange',
    },
    {
      label: 'Brouillons à finaliser',
      description: 'Documents pas encore envoyés',
      count: draftsRes.count ?? 0,
      href: '/documents?status=brouillon',
      tone: 'navy',
    },
    ...stockTasks,
  ];

  const stockRows = [
    {
      label: 'Véhicules en stock',
      hint: `${products.length} modèle${products.length > 1 ? 's' : ''} au catalogue`,
      value: String(vehiclesInStock),
      href: '/products',
    },
    {
      label: 'Modèles à réapprovisionner',
      value: String(lowVehicles),
      href: '/products',
      tone: lowVehicles > 0 ? ('orange' as const) : undefined,
    },
    {
      label: 'Références de pièces actives',
      hint: partsToActivate > 0 ? `${partsToActivate} en attente d'activation` : undefined,
      value: String(activeParts.length),
      href: '/pieces',
    },
    {
      label: 'Pièces sous le seuil',
      value: String(lowParts),
      href: '/pieces',
      tone: lowParts > 0 ? ('red' as const) : undefined,
    },
  ];

  // ---------- En-tête ----------
  const firstName = (profile?.full_name ?? '').split(' ')[0];
  const todayLabel = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TZ,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-gray-500 first-letter:uppercase">{todayLabel}</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-gray-900">
            Bonjour{firstName ? `, ${firstName}` : ''}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {isCommercialSide && (
            <>
              <Link href="/documents/new/facture" className="btn-secondary">
                Nouvelle facture
              </Link>
              <Link href="/documents/new/devis" className="btn-primary">
                <IconPlus className="w-4 h-4" /> Nouveau devis
              </Link>
            </>
          )}
          {isShowroom && (
            <Link href="/documents/new/proforma" className="btn-primary">
              <IconPlus className="w-4 h-4" /> Nouveau proforma
            </Link>
          )}
          {!isCommercialSide && canOpenRepairOrder && (
            <Link href="/atelier/new" className={isShowroom ? 'btn-secondary' : 'btn-primary'}>
              <IconWrench className="w-4 h-4" /> Ordre de réparation
            </Link>
          )}
        </div>
      </div>

      {role && <MfaNudgeBanner role={role} />}
      {(isCommercialSide || isShowroom) && <PendingDocumentsWidget />}

      {isCommercialSide ? (
        <>
          <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <KpiCard
              label="Encaissé ce mois"
              value={formatAmount(collectedThisMonth)}
              unit="FCFA"
              hint={collectedHint}
              hintTone={collectedTone}
              icon={<IconCash className="w-4 h-4" />}
              tone="green"
            />
            <KpiCard
              label="Reste à encaisser"
              value={formatAmount(totalUnpaid)}
              unit="FCFA"
              hint={
                overdueCount > 0
                  ? `${overdueCount} facture${overdueCount > 1 ? 's' : ''} en retard`
                  : `${unpaid.length} document${unpaid.length > 1 ? 's' : ''} concerné${unpaid.length > 1 ? 's' : ''}`
              }
              hintTone={overdueCount > 0 ? 'red' : 'gray'}
              icon={<IconAlert className="w-4 h-4" />}
              tone="red"
              href="/impayes"
            />
            <KpiCard
              label="Facturé ce mois"
              value={formatAmount(invoicedThisMonth)}
              unit="FCFA"
              hint={`${monthInvoices.length} facture${monthInvoices.length > 1 ? 's' : ''} émise${monthInvoices.length > 1 ? 's' : ''}`}
              icon={<IconDocument className="w-4 h-4" />}
              tone="navy"
              href="/documents?type=facture"
            />
            <KpiCard
              label="Clients"
              value={String(clientsRes.count ?? 0)}
              hint={`${prospectsRes.count ?? 0} prospect${(prospectsRes.count ?? 0) > 1 ? 's' : ''} actif${(prospectsRes.count ?? 0) > 1 ? 's' : ''}`}
              icon={<IconUsers className="w-4 h-4" />}
              tone="navy"
              href="/clients"
            />
          </section>

          <section className="grid gap-4 sm:gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2 h-full">
              <RevenueChart months={months} />
            </div>
            <TaskList items={commercialTasks} />
          </section>

          <section className="grid gap-4 sm:gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RecentDocuments documents={recentDocuments} createHref="/documents/new/devis" createLabel="Créer un devis" />
            </div>
            <div className="space-y-4 sm:space-y-5">
              <RepairOrdersCard orders={openOrders} total={openOrdersCount} />
              <StockSummary rows={stockRows} />
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <KpiCard
              label="Véhicules en stock"
              value={String(vehiclesInStock)}
              hint={`${products.length} modèle${products.length > 1 ? 's' : ''} au catalogue`}
              icon={<IconCar className="w-4 h-4" />}
              tone="navy"
              href="/products"
            />
            <KpiCard
              label="Atelier en cours"
              value={String(openOrdersCount)}
              hint="Ordres de réparation ouverts"
              icon={<IconWrench className="w-4 h-4" />}
              tone="orange"
              href="/atelier"
            />
            <KpiCard
              label="Pièces sous le seuil"
              value={String(lowParts)}
              hint={
                lowParts > 0
                  ? 'À réapprovisionner'
                  : `${activeParts.length} référence${activeParts.length > 1 ? 's' : ''} active${activeParts.length > 1 ? 's' : ''}`
              }
              hintTone={lowParts > 0 ? 'red' : 'gray'}
              icon={<IconBox className="w-4 h-4" />}
              tone="red"
              href="/pieces"
            />
            <KpiCard
              label="Garanties suivies"
              value={String(warrantiesRes.count ?? 0)}
              hint="5 ans ou 100 000 km"
              icon={<IconShield className="w-4 h-4" />}
              tone="green"
              href="/garanties"
            />
          </section>

          <section className="grid gap-4 sm:gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4 sm:space-y-5">
              {isShowroom && (
                <RecentDocuments
                  title="Mes derniers proformas"
                  documents={recentDocuments}
                  createHref="/documents/new/proforma"
                  createLabel="Créer un proforma"
                />
              )}
              <RepairOrdersCard orders={openOrders} total={openOrdersCount} />
            </div>
            <div className="space-y-4 sm:space-y-5">
              <TaskList items={stockTasks} />
              <StockSummary rows={stockRows} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
