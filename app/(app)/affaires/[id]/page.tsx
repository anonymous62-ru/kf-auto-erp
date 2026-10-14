import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getDeal } from '@/lib/crm/deals';
import { dealStage, eventType, temperature, EVENT_STATUS } from '@/lib/crm/labels';
import { clientDisplayName, documentTypeLabel, documentStatus } from '@/lib/documents/labels';
import { formatCFA } from '@/lib/documents/calculations';
import { getCurrentProfile } from '@/lib/permissions';
import { DIRECTION_ROLES } from '@/lib/users/roles';
import { DealEditor } from '@/components/crm/deal-editor';
import { EventForm } from '@/components/crm/event-form';

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deal = await getDeal(id);
  if (!deal) notFound();
  const me = await getCurrentProfile();
  const isDirection = DIRECTION_ROLES.includes(me?.role ?? '');
  const canEdit = isDirection || deal.assigned_to === me?.id;
  const supabase = await createClient();

  const [{ data: docs }, { data: events }] = await Promise.all([
    deal.client_id
      ? supabase
          .from('documents')
          .select('id, document_type, document_number, status, total_amount')
          .eq('client_id', deal.client_id)
          .in('document_type', ['devis', 'commande', 'facture'])
          .order('created_at', { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] as { id: string; document_type: string; document_number: string | null; status: string; total_amount: number }[] }),
    supabase
      .from('agenda_events')
      .select('id, event_type, title, starts_at, status')
      .eq('deal_id', id)
      .order('starts_at', { ascending: false })
      .limit(20),
  ]);

  const t = temperature(deal.temperature);
  const st = dealStage(deal.stage);
  const contact = deal.client ? clientDisplayName(deal.client) : deal.lead ? clientDisplayName(deal.lead) : 'Contact non renseigné';

  return (
    <div className="space-y-4 max-w-2xl">
      <Link href="/affaires" className="text-sm text-gray-500 hover:text-kf-navy">
        ← Affaires
      </Link>
      <div className="card p-4">
        <p className="flex items-center gap-2 text-xs text-gray-500">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${t.dot}`} /> Affaire {t.label.toLowerCase()} ·{' '}
          {deal.owner?.full_name ?? ''}
        </p>
        <h1 className="page-title">{deal.title}</h1>
        <p className="mt-1 text-sm text-gray-600">
          {deal.client_id ? (
            <Link href={`/clients/${deal.client_id}`} className="hover:text-kf-navy">
              {contact}
            </Link>
          ) : deal.lead_id ? (
            <Link href={`/prospects/${deal.lead_id}`} className="hover:text-kf-navy">
              {contact} (lead)
            </Link>
          ) : (
            contact
          )}
          {deal.product ? ` · ${deal.product.designation}${deal.quantity > 1 ? ` x${deal.quantity}` : ''}` : ''}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className={st.badge}>{st.label}</span>
          <span className="font-medium">{formatCFA(deal.estimated_amount)}</span>
          {deal.expected_close_date && (
            <span className="text-xs text-gray-500">
              conclusion prévue le {new Date(`${deal.expected_close_date}T00:00:00`).toLocaleDateString('fr-FR')}
            </span>
          )}
        </p>
        {deal.stage === 'perdue' && deal.lost_reason && <p className="mt-2 text-xs text-gray-600">Perdue : {deal.lost_reason}</p>}
        {deal.document && deal.document_id && (
          <p className="mt-2 text-sm text-gray-700">
            {documentTypeLabel(deal.document.document_type)}{' '}
            <Link href={`/documents/${deal.document_id}`} className="font-medium text-kf-navy hover:underline">
              {deal.document.document_number}
            </Link>{' '}
            <span className={documentStatus(deal.document.status, deal.document.document_type).badge}>
              {documentStatus(deal.document.status, deal.document.document_type).label}
            </span>
          </p>
        )}
        {canEdit && (
          <div className="mt-3">
            {deal.client_id ? (
              !deal.document_id && (
                <Link href={`/documents/new/devis?clientId=${deal.client_id}`} className="btn-primary">
                  Faire la facture proforma
                </Link>
              )
            ) : deal.lead_id ? (
              <p className="text-xs text-gray-500">
                Pour faire une facture proforma, ouvrez le{' '}
                <Link href={`/prospects/${deal.lead_id}`} className="text-kf-navy underline">
                  lead
                </Link>{' '}
                et créez sa fiche contact : l&apos;affaire la suivra automatiquement.
              </p>
            ) : null}
          </div>
        )}
      </div>

      <DealEditor
        deal={{
          id: deal.id,
          temperature: deal.temperature,
          stage: deal.stage,
          estimated_amount: deal.estimated_amount,
          expected_close_date: deal.expected_close_date,
          notes: deal.notes,
          lost_reason: deal.lost_reason,
          document_id: deal.document_id,
        }}
        documents={(docs ?? []).map((d) => ({
          id: d.id,
          label: `${documentTypeLabel(d.document_type)} ${d.document_number ?? ''} · ${formatCFA(Number(d.total_amount))}`,
        }))}
        canEdit={canEdit}
        canRemove={isDirection}
      />

      <div className="card p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-900">Agenda de l&apos;affaire</p>
        {(events ?? []).length === 0 ? (
          <p className="text-sm text-gray-500">Aucun rendez-vous, essai ou relance pour cette affaire.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {(events ?? []).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{e.title}</span>{' '}
                  <span className="text-xs text-gray-500">
                    {eventType(e.event_type).label} ·{' '}
                    {new Date(e.starts_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Lome' })}
                  </span>
                </span>
                <span className={EVENT_STATUS[e.status as keyof typeof EVENT_STATUS]?.badge ?? 'badge-gray'}>
                  {EVENT_STATUS[e.status as keyof typeof EVENT_STATUS]?.label ?? e.status}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="border-t pt-3">
            <EventForm defaults={{ title: deal.title, clientId: deal.client_id, leadId: deal.lead_id, dealId: deal.id }} />
          </div>
        )}
      </div>
    </div>
  );
}
