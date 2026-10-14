import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatCFA } from '@/lib/documents/calculations';
import { IconPhone, IconChat, IconMail, IconMapPin } from '@/components/icons';
import { DOCUMENT_TYPE_LABELS, documentStatus, clientStatus } from '@/lib/documents/labels';
import { SendCatalogueButton } from '@/components/catalogue/send-catalogue';
import { CatalogueSendingHistory } from '@/components/catalogue/sending-history';
import { listCatalogueChoices, listCatalogueSendings } from '@/lib/catalogue/actions';
import { CATALOGUE_SENDER_ROLES } from '@/lib/catalogue/roles';
import { getCurrentRole } from '@/lib/permissions';
import { toWhatsappNumber } from '@/lib/utils/phone';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  especes: 'Espèces',
  virement: 'Virement',
  cheque: 'Chèque',
  mobile_money_flooz: 'Flooz',
  mobile_money_tmoney: 'TMoney',
  autre: 'Autre',
};

const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '');

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ onglet?: string }>;
}) {
  const { id } = await params;
  const { onglet } = await searchParams;
  const tab = ['documents', 'paiements', 'historique'].includes(onglet ?? '') ? (onglet as string) : 'infos';
  const supabase = await createClient();

  const { data: client } = await supabase
    .from('clients')
    .select('id, first_name, last_name, company_name, phone, whatsapp, email, address, city, notes, client_type, status, client_number, client_since, created_at')
    .eq('id', id)
    .maybeSingle();
  if (!client) notFound();

  const [{ data: documents }, role, choices, sendings, { data: deals }] = await Promise.all([
    supabase
      .from('documents')
      .select('id, document_type, document_number, status, total_amount, balance_due, issue_date, due_date')
      .eq('client_id', id)
      .order('issue_date', { ascending: false }),
    getCurrentRole(),
    listCatalogueChoices(),
    listCatalogueSendings({ clientId: id }),
    supabase.from('deals').select('id, title, stage, temperature, estimated_amount, updated_at').eq('client_id', id).order('updated_at', { ascending: false }),
  ]);
  const docIds = (documents ?? []).map((d) => d.id);
  const { data: payments } = docIds.length
    ? await supabase
        .from('payments')
        .select('id, amount, payment_method, payment_date, reference, document_id')
        .in('document_id', docIds)
        .order('payment_date', { ascending: false })
    : { data: [] as { id: string; amount: number; payment_method: string; payment_date: string; reference: string | null; document_id: string }[] };
  const canSendCatalogue = CATALOGUE_SENDER_ROLES.includes(role ?? '');

  const clientName = client.company_name || `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim() || 'Client sans nom';
  const invoices = (documents ?? []).filter((d) => d.document_type === 'facture' && d.status !== 'annule');
  const totalUnpaid = invoices.reduce((sum, d) => sum + Number(d.balance_due ?? 0), 0);
  const totalBilled = invoices.reduce((sum, d) => sum + Number(d.total_amount), 0);
  const totalPaid = (payments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
  const st = clientStatus(client.status);
  const wa = toWhatsappNumber(client.whatsapp || client.phone);
  const docNumber = new Map((documents ?? []).map((d) => [d.id, d.document_number]));

  return (
    <div>
      <PageHeader
        back={{ href: '/clients', label: 'Clients et prospects' }}
        title={clientName}
        description={client.client_type === 'entreprise' ? 'Entreprise' : 'Particulier'}
        meta={
          <>
            <span className={st.badge}>{st.label}</span>
            {client.client_number ? (
              <span>
                N° client <span className="num font-medium text-[#1f2937]">{client.client_number}</span>
                {client.client_since && ` depuis le ${fmtDate(client.client_since)}`}
              </span>
            ) : (
              <span>Deviendra client au premier versement</span>
            )}
            {client.phone && <span className="num">{client.phone}</span>}
          </>
        }
        actions={
          <>
            {wa && (
              <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="btn-secondary">
                <IconChat className="h-4 w-4" /> WhatsApp
              </a>
            )}
            <Link href={`/clients/${client.id}/edit`} className="btn-secondary">
              Modifier
            </Link>
            <Link href={`/documents/new/devis?clientId=${client.id}`} className="btn-primary">
              Nouvelle proforma
            </Link>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-[13px] text-gray-500">Total facturé</p>
          <p className="num mt-1 text-xl font-semibold">{formatCFA(totalBilled)}</p>
        </div>
        <div className="card p-4">
          <p className="text-[13px] text-gray-500">Encaissé</p>
          <p className="num mt-1 text-xl font-semibold">{formatCFA(totalPaid)}</p>
        </div>
        <div className="card p-4">
          <p className="text-[13px] text-gray-500">Solde dû</p>
          <p className={`num mt-1 text-xl font-semibold ${totalUnpaid > 0 ? 'text-kf-red' : ''}`}>{formatCFA(totalUnpaid)}</p>
        </div>
        <div className="card p-4">
          <p className="text-[13px] text-gray-500">Documents</p>
          <p className="num mt-1 text-xl font-semibold">{(documents ?? []).length}</p>
        </div>
      </div>

      <Tabs
        basePath={`/clients/${client.id}`}
        active={tab}
        tabs={[
          { key: 'infos', label: 'Infos' },
          { key: 'documents', label: 'Documents', count: (documents ?? []).length },
          { key: 'paiements', label: 'Paiements', count: (payments ?? []).length },
          { key: 'historique', label: 'Historique', count: sendings.length + (deals ?? []).length },
        ]}
      />

      {tab === 'infos' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card p-4 lg:col-span-2">
            <p className="section-title mb-3">Coordonnées</p>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-gray-500">Téléphone</dt>
                <dd className="mt-0.5 flex items-center gap-1.5">
                  <IconPhone className="h-3.5 w-3.5 text-gray-400" /> {client.phone || '-'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">WhatsApp</dt>
                <dd className="mt-0.5 flex items-center gap-1.5">
                  <IconChat className="h-3.5 w-3.5 text-gray-400" /> {client.whatsapp || client.phone || '-'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">E-mail</dt>
                <dd className="mt-0.5 flex items-center gap-1.5">
                  <IconMail className="h-3.5 w-3.5 text-gray-400" /> {client.email || '-'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Adresse</dt>
                <dd className="mt-0.5 flex items-center gap-1.5">
                  <IconMapPin className="h-3.5 w-3.5 text-gray-400" /> {[client.address, client.city].filter(Boolean).join(', ') || '-'}
                </dd>
              </div>
            </dl>
            {client.notes && (
              <div className="mt-4 border-t border-gray-100 pt-3">
                <p className="text-xs text-gray-500">Notes</p>
                <p className="mt-0.5 whitespace-pre-line text-sm">{client.notes}</p>
              </div>
            )}
            <p className="mt-4 text-xs text-gray-400">Contact créé le {fmtDate(client.created_at)}</p>
          </div>
          <div className="space-y-2">
            <Link href={`/affaires/new?clientId=${client.id}`} className="btn-secondary w-full">
              Ouvrir une affaire
            </Link>
            {canSendCatalogue && choices.length > 0 && (
              <SendCatalogueButton
                choices={choices}
                variant="secondary"
                block
                defaults={{ clientId: client.id, name: clientName, phone: client.whatsapp || client.phone, email: client.email }}
              />
            )}
          </div>
        </div>
      )}

      {tab === 'documents' && (
        <div className="table-wrap">
          {(documents ?? []).length === 0 ? (
            <EmptyState
              compact
              title="Aucun document pour ce contact"
              action={{ href: `/documents/new/devis?clientId=${client.id}`, label: 'Créer une facture proforma' }}
            />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Numéro</th>
                  <th className="hidden sm:table-cell">Type</th>
                  <th className="hidden sm:table-cell">Date</th>
                  <th className="num">Montant</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {(documents ?? []).map((d) => {
                  const s = documentStatus(d.status, d.document_type, { dueDate: d.due_date, balance: Number(d.balance_due) });
                  return (
                    <tr key={d.id}>
                      <td>
                        <Link href={`/documents/${d.id}`} className="font-medium hover:text-kf-navy">
                          {d.document_number ?? '(en attente)'}
                        </Link>
                        <span className="block text-xs text-gray-500 sm:hidden">{DOCUMENT_TYPE_LABELS[d.document_type] ?? d.document_type}</span>
                      </td>
                      <td className="hidden text-gray-600 sm:table-cell">{DOCUMENT_TYPE_LABELS[d.document_type] ?? d.document_type}</td>
                      <td className="tabular-nums hidden text-gray-500 sm:table-cell">{fmtDate(d.issue_date)}</td>
                      <td className="num whitespace-nowrap font-medium">{formatCFA(Number(d.total_amount))}</td>
                      <td>
                        <span className={s.badge}>{s.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'paiements' && (
        <div className="table-wrap">
          {(payments ?? []).length === 0 ? (
            <EmptyState compact title="Aucun paiement" description="Les paiements se saisissent depuis la facture concernée." />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Document</th>
                  <th className="hidden sm:table-cell">Mode</th>
                  <th className="num">Montant</th>
                </tr>
              </thead>
              <tbody>
                {(payments ?? []).map((p) => (
                  <tr key={p.id}>
                    <td className="tabular-nums">{fmtDate(p.payment_date)}</td>
                    <td>
                      <Link href={`/documents/${p.document_id}`} className="hover:text-kf-navy">
                        {docNumber.get(p.document_id) ?? 'Document'}
                      </Link>
                    </td>
                    <td className="hidden text-gray-600 sm:table-cell">{PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method}</td>
                    <td className="num font-medium">{formatCFA(Number(p.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'historique' && (
        <div className="space-y-4">
          <div className="card p-4">
            <p className="section-title">Affaires</p>
            {(deals ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">Aucune affaire pour ce contact.</p>
            ) : (
              <ul className="mt-2 divide-y divide-gray-100">
                {(deals ?? []).map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <Link href={`/affaires/${d.id}`} className="hover:text-kf-navy">
                      {d.title}
                    </Link>
                    <span className="num text-gray-500">{formatCFA(Number(d.estimated_amount ?? 0))}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <CatalogueSendingHistory rows={sendings} showRecipient />
        </div>
      )}
    </div>
  );
}
