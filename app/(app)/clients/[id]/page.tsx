import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatCFA } from '@/lib/documents/calculations';
import { IconPhone, IconChat, IconMail, IconMapPin } from '@/components/icons';

const DOCUMENT_LABELS: Record<string, string> = {
  proforma: 'Proforma',
  devis: 'Devis',
  facture: 'Facture',
  bon_livraison: 'Bon de livraison',
  recu: 'Reçu',
  avoir: 'Avoir',
};

const STATUS_COLORS: Record<string, string> = {
  brouillon: 'bg-gray-100 text-gray-600',
  envoye: 'bg-amber-100 text-amber-700',
  accepte: 'bg-blue-100 text-blue-700',
  refuse: 'bg-red-100 text-red-700',
  paye_partiel: 'bg-amber-100 text-amber-700',
  paye: 'bg-green-100 text-green-700',
  annule: 'bg-gray-200 text-gray-500',
};

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from('clients')
    .select('id, first_name, last_name, company_name, phone, whatsapp, email, address, city, notes, client_type')
    .eq('id', id)
    .maybeSingle();

  if (!client) notFound();

  const { data: documents } = await supabase
    .from('documents')
    .select('id, document_type, document_number, status, total_amount, balance_due, issue_date')
    .eq('client_id', id)
    .order('issue_date', { ascending: false });

  const clientName = client.company_name || `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim();
  const totalUnpaid = (documents ?? []).reduce((sum, d) => sum + Number(d.balance_due ?? 0), 0);
  const totalBilled = (documents ?? [])
    .filter((d) => d.document_type === 'facture')
    .reduce((sum, d) => sum + Number(d.total_amount), 0);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-gray-500">{client.client_type === 'entreprise' ? 'Entreprise' : 'Particulier'}</p>
            <h1 className="text-lg font-medium">{clientName || 'Client sans nom'}</h1>
          </div>
          <Link href={`/clients/${client.id}/edit`} className="btn-secondary text-xs px-3 py-1.5 shrink-0">
            Modifier
          </Link>
        </div>
        <div className="text-sm text-gray-600 mt-2 space-y-1">
          {client.phone && (
            <p className="flex items-center gap-1.5">
              <IconPhone className="w-3.5 h-3.5 text-gray-400" /> {client.phone}
            </p>
          )}
          {client.whatsapp && client.whatsapp !== client.phone && (
            <p className="flex items-center gap-1.5">
              <IconChat className="w-3.5 h-3.5 text-gray-400" /> WhatsApp : {client.whatsapp}
            </p>
          )}
          {client.email && (
            <p className="flex items-center gap-1.5">
              <IconMail className="w-3.5 h-3.5 text-gray-400" /> {client.email}
            </p>
          )}
          {(client.address || client.city) && (
            <p className="flex items-center gap-1.5">
              <IconMapPin className="w-3.5 h-3.5 text-gray-400" /> {client.address ?? ''} {client.city ?? ''}
            </p>
          )}
        </div>
        {client.notes && <p className="text-xs text-gray-500 mt-2 border-t pt-2">{client.notes}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-3">
          <p className="text-xs text-gray-500">Total facturé</p>
          <p className="text-lg font-medium">{formatCFA(totalBilled)}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-gray-500">Solde dû</p>
          <p className={`text-lg font-medium ${totalUnpaid > 0 ? 'text-kf-red' : 'text-green-600'}`}>
            {formatCFA(totalUnpaid)}
          </p>
        </div>
      </div>

      <Link href={`/documents/new/devis?clientId=${client.id}`} className="btn-primary w-full justify-center">
        Nouveau document pour ce client
      </Link>

      <div className="space-y-2">
        <p className="text-xs text-gray-500 uppercase tracking-wide">Historique</p>
        {(documents ?? []).length === 0 && <p className="text-sm text-gray-400">Aucun document pour ce client.</p>}
        {(documents ?? []).map((d) => (
          <Link key={d.id} href={`/documents/${d.id}`} className="card card-hover block p-3">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-gray-500">{DOCUMENT_LABELS[d.document_type] ?? d.document_type}</p>
                <p className="font-medium text-sm">{d.document_number ?? '(en attente)'}</p>
                <p className="text-xs text-gray-400">{d.issue_date}</p>
              </div>
              <div className="text-right">
                <p className="font-medium text-sm">{formatCFA(Number(d.total_amount))}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[d.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {d.status}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
