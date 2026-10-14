import { createClient } from '@/lib/supabase/server';
import { formatCFA } from '@/lib/documents/calculations';
import { notFound } from 'next/navigation';
import { SendActions } from '@/components/documents/send-actions';
import { PaymentForm } from '@/components/payments/payment-form';
import { getPayments } from '@/lib/payments/actions';
import { ConvertDocumentButton } from '@/components/documents/convert-document-button';
import { documentTypeLabel, documentStatus, clientStatus } from '@/lib/documents/labels';
import { BILLING_ROLES } from '@/lib/users/roles';
import Link from 'next/link';
import { listVehicleUnits } from '@/lib/stock/actions';
import { ageLabel, daysInStock, vehicleStatus } from '@/lib/stock/labels';
import { ItemVehiclePicker } from '@/components/stock/item-vehicle-picker';
import { signedStorageUrl } from '@/lib/storage/signed-url';
import { DeleteDocumentButton } from '@/components/documents/delete-document-button';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';
import { CancelDraftInvoiceButton, CreateAvoirForm } from '@/components/documents/invoice-controls';
import {
  CREDIT_NOTE_ROLES,
  INVOICE_EDITOR_ROLES,
  invoiceEditBlockReason,
  isInvoiceLike,
  isLockedInvoice,
} from '@/lib/documents/invoice-rules';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  especes: 'Espèces',
  virement: 'Virement',
  cheque: 'Chèque',
  mobile_money_flooz: 'Flooz',
  mobile_money_tmoney: 'TMoney',
  autre: 'Autre',
};

export default async function DocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ onglet?: string }>;
}) {
  const { id } = await params;
  const { onglet } = await searchParams;
  const supabase = await createClient();

  // Suppression réservée à la direction (règle du 04/10) : le bouton n'est
  // affiché qu'à elle, la base refuse de toute façon pour les autres.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user?.id ?? '').maybeSingle();
  const role = me?.role ?? '';
  const canInvoice = BILLING_ROLES.includes(role);

  const { data: document } = await supabase
    .from('documents')
    .select(
      `id, public_token, document_type, document_number, status, subtotal, tax_amount, total_amount, amount_paid, balance_due,
       due_date, issue_date, commercial_signature_url, client_signature_url, client_id, parent_document_id, commercial_id,
       clients (first_name, last_name, company_name, phone, email, status, client_number)`
    )
    .eq('id', id)
    .single();

  if (!document) notFound();

  const { data: items } = await supabase
    .from('document_items')
    .select('id, product_id, designation, quantity, unit_price, tax_rate, line_total')
    .eq('document_id', id)
    .order('position');

  const payments = await getPayments(id);

  // Chaîne du circuit de vente : document d'origine et documents issus de celui-ci.
  const [{ data: parent }, { data: children }] = await Promise.all([
    document.parent_document_id
      ? supabase
          .from('documents')
          .select('id, document_type, document_number')
          .eq('id', document.parent_document_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('documents')
      .select('id, document_type, document_number, status, total_amount')
      .eq('parent_document_id', id)
      .order('created_at'),
  ]);
  const { data: history } = await supabase
    .from('document_history')
    .select('id, message, created_at, profiles (full_name)')
    .eq('document_id', id)
    .order('created_at', { ascending: false });

  const client = Array.isArray(document.clients) ? document.clients[0] : document.clients;
  const [commercialSignature, clientSignature] = await Promise.all([
    signedStorageUrl(document.commercial_signature_url),
    signedStorageUrl(document.client_signature_url),
  ]);
  const balanceDue = Number(document.balance_due);
  const isFactureOuRecu = document.document_type === 'facture' || document.document_type === 'recu';
  const isClosed = ['accepte', 'annule', 'refuse'].includes(document.status);
  const hasChild = (type: string) =>
    (children ?? []).some((c) => c.document_type === type && c.status !== 'annule');

  // Sécurité des factures (12/10) : modifiable par l'administration des
  // ventes jusqu'au premier paiement, puis verrouillée (correction par avoir).
  const invoiceLike = isInvoiceLike(document.document_type);
  const locked = isLockedInvoice(document.document_type, document.status, Number(document.amount_paid));
  const editBlock = invoiceEditBlockReason(document.document_type, document.status, role, Number(document.amount_paid));
  const canEditDocument = Number(document.amount_paid) === 0 && !!document.document_number && !editBlock;
  const canDelete = ['super_admin', 'administrateur', 'manager'].includes(role) && !invoiceLike;
  const avoirs = (children ?? []).filter((c) => c.document_type === 'avoir' && c.status !== 'annule');
  const credited = avoirs.reduce((sum, a) => sum + Number(a.total_amount), 0);
  const remainingToCredit = Math.max(Number(document.total_amount) - credited, 0);
  const isFacture = document.document_type === 'facture';
  const canCancelDraft = isFacture && !locked && CREDIT_NOTE_ROLES.includes(role);
  const canCreateAvoir =
    isFacture && locked && document.status !== 'annule' && CREDIT_NOTE_ROLES.includes(role) && remainingToCredit > 0;
  const canConvertToCommande =
    ['devis', 'proforma'].includes(document.document_type) && !isClosed && !hasChild('commande');
  const isCommandeToInvoice = document.document_type === 'commande' && !isClosed && !hasChild('facture');

  // Numéros de châssis (étape 2) : sur une commande ou une facture, chaque
  // ligne d'un modèle suivi par châssis reçoit ses véhicules.
  type Picker = {
    itemId: string;
    designation: string;
    quantity: number;
    selected: { id: string; vin: string }[];
    options: { id: string; vin: string; color: string | null; ageText: string; statusLabel: string }[];
  };
  let pickers: Picker[] = [];
  let canPickVehicles = false;
  if (['commande', 'facture'].includes(document.document_type) && (items ?? []).some((i) => i.product_id)) {
    const [{ units }, { data: links }] = await Promise.all([
      listVehicleUnits(),
      supabase.from('document_item_vehicles').select('document_item_id, vehicle_unit_id').eq('document_id', id).is('removed_at', null),
    ]);
    const isPaid = Number(document.amount_paid) > 0;
    canPickVehicles =
      !['annule', 'refuse'].includes(document.status) &&
      !(document.document_type === 'facture' && (locked || !INVOICE_EDITOR_ROLES.includes(role))) &&
      !(document.document_type === 'commande' && document.status === 'accepte') &&
      (isPaid
        ? ['super_admin', 'administrateur', 'manager'].includes(role)
        : document.commercial_id === user?.id || ['super_admin', 'administrateur', 'manager', 'admin_ventes'].includes(role));
    pickers = (items ?? [])
      .filter((i) => i.product_id && units.some((u) => u.product_id === i.product_id))
      .map((i) => {
        const selectedIds = (links ?? []).filter((l) => l.document_item_id === i.id).map((l) => l.vehicle_unit_id as string);
        const selected = units.filter((u) => selectedIds.includes(u.id)).map((u) => ({ id: u.id, vin: u.vin }));
        const options = units
          .filter(
            (u) =>
              u.product_id === i.product_id &&
              (selectedIds.includes(u.id) ||
                (!['vendu', 'endommage'].includes(u.status) &&
                  (!u.document_id || u.document_id === id || u.document_id === document.parent_document_id)))
          )
          .sort((a, b) => a.entry_date.localeCompare(b.entry_date))
          .map((u) => ({
            id: u.id,
            vin: u.vin,
            color: u.color,
            ageText: ageLabel(daysInStock(u.entry_date)),
            statusLabel: vehicleStatus(u.status).label,
          }));
        return { itemId: i.id, designation: i.designation, quantity: Number(i.quantity), selected, options };
      });
  }
  const cStatus = clientStatus(client?.status);
  const { data: commercialProfile } = document.commercial_id
    ? await supabase.from('profiles').select('full_name').eq('id', document.commercial_id).maybeSingle()
    : { data: null };
  const clientName = client?.company_name || `${client?.first_name ?? ''} ${client?.last_name ?? ''}`.trim() || 'Client';
  const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '');
  const chain = [...(parent ? [parent] : []), ...(children ?? [])];
  const tab = ['documents', 'paiements', 'historique'].includes(onglet ?? '') ? (onglet as string) : 'infos';
  const canSign = document.document_type !== 'avoir' && document.status !== 'annule' && !document.client_signature_url;

  const showPayments = isFactureOuRecu && document.status !== 'annule';
  const statusExtra = documentStatus(document.status, document.document_type, {
    dueDate: document.due_date,
    balance: balanceDue,
  });

  return (
    <div>
      <PageHeader
        back={{ href: '/documents', label: 'Documents' }}
        title={document.document_number ?? '(en attente de synchronisation)'}
        description={documentTypeLabel(document.document_type)}
        meta={
          <>
            <span className={statusExtra.badge}>{statusExtra.label}</span>
            <Link href={`/clients/${document.client_id}`} className="font-medium text-[#1f2937] hover:text-kf-navy">
              {clientName}
            </Link>
            <span className={cStatus.badge}>{cStatus.label}</span>
            {client?.client_number && <span>{client.client_number}</span>}
            {document.issue_date && <span>Émis le {fmtDate(document.issue_date)}</span>}
            {commercialProfile?.full_name && <span>Par {commercialProfile.full_name}</span>}
          </>
        }
        actions={
          <>
            <a href={`/api/documents/${document.id}/pdf`} target="_blank" className="btn-secondary">
              PDF
            </a>
            {canSign && (
              <a href={`/documents/${document.id}/sign`} className="btn-secondary">
                Faire signer
              </a>
            )}
            {canEditDocument && (
              <a href={`/documents/${document.id}/edit`} className="btn-primary">
                Modifier
              </a>
            )}
          </>
        }
      />

      {invoiceLike && document.status === 'annule' && (
        <div className="mb-4 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
          {avoirs.length > 0 ? (
            <>
              Facture annulée par{' '}
              {avoirs.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && ', '}
                  <Link href={`/documents/${a.id}`} className="font-medium text-kf-navy hover:underline">
                    l&apos;avoir {a.document_number}
                  </Link>
                </span>
              ))}
              . Son numéro reste réservé et n&apos;est jamais réutilisé.
            </>
          ) : (
            <>Facture annulée avant tout paiement. Son numéro reste réservé et n&apos;est jamais réutilisé.</>
          )}
        </div>
      )}
      {locked && document.status !== 'annule' && (
        <div className="mb-4 rounded-md border border-[#d5dbe8] bg-[#f3f5fa] px-3 py-2 text-sm text-kf-navy">
          {document.document_type === 'avoir'
            ? 'Avoir émis : il ne peut plus être modifié.'
            : 'Paiement enregistré : la facture ne peut plus être modifiée. Toute correction passe par un avoir.'}
          {avoirs.length > 0 && (
            <span className="mt-1 block text-gray-700">
              Avoirs déjà établis : {formatCFA(credited)}. Reste dû après avoirs :{' '}
              {formatCFA(Math.max(Number(document.total_amount) - credited - Number(document.amount_paid), 0))}.
            </span>
          )}
        </div>
      )}
      {isFacture && !locked && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Facture modifiable par l&apos;administration des ventes jusqu&apos;au premier paiement. Dès qu&apos;un
          versement est enregistré, elle est verrouillée.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Tabs
            basePath={`/documents/${document.id}`}
            active={tab}
            tabs={[
              { key: 'infos', label: 'Infos' },
              { key: 'documents', label: 'Documents', count: chain.length },
              ...(showPayments ? [{ key: 'paiements', label: 'Paiements', count: payments.length }] : []),
              { key: 'historique', label: 'Historique', count: (history ?? []).length },
            ]}
          />

          {tab === 'infos' && (
            <div className="space-y-4">
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Désignation</th>
                      <th className="num">Qté</th>
                      <th className="num hidden sm:table-cell">Prix unitaire</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items?.map((item) => (
                      <tr key={item.id}>
                        <td className="max-w-[320px]">
                          <span className="block whitespace-pre-line text-[13px] leading-5">
                            {String(item.designation).split('\n')[0]}
                          </span>
                          {String(item.designation).includes('\n') && (
                            <details className="mt-0.5 text-xs text-gray-500">
                              <summary className="cursor-pointer select-none hover:text-kf-navy">Caractéristiques</summary>
                              <span className="mt-1 block whitespace-pre-line">
                                {String(item.designation).split('\n').slice(1).join('\n')}
                              </span>
                            </details>
                          )}
                        </td>
                        <td className="num">{Number(item.quantity)}</td>
                        <td className="num hidden whitespace-nowrap sm:table-cell">{formatCFA(Number(item.unit_price))}</td>
                        <td className="num whitespace-nowrap font-medium">{formatCFA(Number(item.line_total))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="space-y-1 border-t border-gray-200 px-3 py-3 text-sm">
                  <div className="flex justify-between text-gray-600">
                    <span>Sous-total</span>
                    <span className="num">{formatCFA(Number(document.subtotal))}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>TVA</span>
                    <span className="num">{formatCFA(Number(document.tax_amount))}</span>
                  </div>
                  <div className="flex justify-between pt-1 font-semibold">
                    <span>Total TTC</span>
                    <span className="num">{formatCFA(Number(document.total_amount))}</span>
                  </div>
                </div>
              </div>

              {pickers.length > 0 && (
                <div className="card space-y-2 p-4">
                  <p className="section-title">Véhicules (numéros de châssis)</p>
                  {pickers.map((p) => (
                    <ItemVehiclePicker key={p.itemId} documentId={document.id} {...p} editable={canPickVehicles} />
                  ))}
                </div>
              )}

              {document.client_signature_url && (
                <div className="card grid grid-cols-2 gap-3 p-4">
                  <div>
                    <p className="mb-1 text-xs text-gray-500">Signature commerciale</p>
                    {commercialSignature && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={commercialSignature} alt="Signature commerciale" className="rounded-md border" />
                    )}
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-gray-500">Signature client</p>
                    {clientSignature && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={clientSignature} alt="Signature client" className="rounded-md border" />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'documents' && (
            <div className="table-wrap">
              {chain.length === 0 ? (
                <EmptyState
                  compact
                  title="Aucun document lié"
                  description="Les commandes, factures et avoirs issus de ce document apparaîtront ici."
                />
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Lien</th>
                      <th>Type</th>
                      <th>Numéro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chain.map((c) => (
                      <tr key={c.id}>
                        <td className="text-gray-500">{parent && c.id === parent.id ? 'Document d\u2019origine' : 'Issu de ce document'}</td>
                        <td>{documentTypeLabel(c.document_type)}</td>
                        <td>
                          <Link href={`/documents/${c.id}`} className="font-medium text-kf-navy hover:underline">
                            {c.document_number}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'paiements' && showPayments && (
            <div className="space-y-4">
              <div className="table-wrap">
                {payments.length === 0 ? (
                  <EmptyState compact title="Aucun paiement enregistré" description="Enregistrez un acompte ou le solde avec le formulaire ci-dessous." />
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Mode</th>
                        <th className="num">Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id}>
                          <td className="tabular-nums">{fmtDate(p.payment_date)}</td>
                          <td>{PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method}</td>
                          <td className="num font-medium">{formatCFA(Number(p.amount))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              {balanceDue > 0 && (
                <div className="card p-4">
                  <PaymentForm
                    documentId={document.id}
                    publicToken={document.public_token}
                    documentNumber={document.document_number}
                    clientId={document.client_id}
                    balanceDue={balanceDue}
                    clientPhone={client?.phone}
                    clientEmail={client?.email}
                  />
                </div>
              )}
            </div>
          )}

          {tab === 'historique' && (
            <div className="card p-4">
              {(history ?? []).length === 0 ? (
                <EmptyState compact title="Pas encore d'historique" description="Création, émission, avoirs et paiements seront tracés ici." />
              ) : (
                <ol className="space-y-3">
                  {(history ?? []).map((h) => {
                    const author = Array.isArray(h.profiles) ? h.profiles[0] : h.profiles;
                    return (
                      <li key={h.id} className="flex gap-3 text-sm">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" />
                        <div className="min-w-0">
                          <p>{h.message}</p>
                          <p className="text-xs text-gray-500">
                            {new Date(h.created_at).toLocaleString('fr-FR', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: 'Africa/Lome',
                            })}
                            {author?.full_name ? ` · ${author.full_name}` : ''}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="card p-4">
            <p className="text-[13px] text-gray-500">Total TTC</p>
            <p className="num mt-1 text-2xl font-semibold tracking-tight">{formatCFA(Number(document.total_amount))}</p>
            {showPayments && (
              <dl className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Payé</dt>
                  <dd className="num">{formatCFA(Number(document.amount_paid))}</dd>
                </div>
                <div className="flex justify-between font-medium">
                  <dt>Reste dû</dt>
                  <dd className={`num ${balanceDue > 0 ? 'text-[#1f2937]' : 'text-emerald-700'}`}>{formatCFA(balanceDue)}</dd>
                </div>
                {document.due_date && balanceDue > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <dt>Échéance</dt>
                    <dd className="num">{fmtDate(document.due_date)}</dd>
                  </div>
                )}
              </dl>
            )}
            {showPayments && balanceDue > 0 && tab !== 'paiements' && (
              <Link href={`/documents/${document.id}?onglet=paiements`} scroll={false} className="btn-secondary mt-3 w-full">
                Enregistrer un paiement
              </Link>
            )}
          </div>

          {(canCreateAvoir || canConvertToCommande || isCommandeToInvoice) && (
            <div className="space-y-2">
              {canCreateAvoir && (
                <CreateAvoirForm
                  factureId={document.id}
                  factureNumber={document.document_number}
                  remaining={remainingToCredit}
                  hasPartial={avoirs.length > 0}
                />
              )}
              {canConvertToCommande && (
                <ConvertDocumentButton documentId={document.id} target="commande" label="Passer en commande" />
              )}
              {isCommandeToInvoice &&
                (canInvoice ? (
                  <ConvertDocumentButton documentId={document.id} target="facture" label="Établir la facture" />
                ) : (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Commande transmise à l&apos;administration des ventes, qui établira la facture.
                  </p>
                ))}
            </div>
          )}

          {document.status !== 'annule' && (
            <SendActions
              documentId={document.id}
              publicToken={document.public_token}
              documentNumber={document.document_number}
              clientPhone={client?.phone}
              clientEmail={client?.email}
            />
          )}

          {canCancelDraft && <CancelDraftInvoiceButton documentId={document.id} documentNumber={document.document_number} />}
          {canDelete && <DeleteDocumentButton documentId={document.id} documentNumber={document.document_number} />}
        </aside>
      </div>
    </div>
  );
}
