import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getCommercialDetail } from '@/lib/team/actions';
import { formatCFA } from '@/lib/documents/calculations';
import { IconChevronRight, IconPhone, IconMail } from '@/components/icons';

const DOCUMENT_LABELS: Record<string, string> = {
  proforma: 'Proforma',
  devis: 'Devis',
  facture: 'Facture',
  bon_livraison: 'Bon de livraison',
  recu: 'Reçu',
  avoir: 'Avoir',
};

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  brouillon: 'Brouillon',
  signe: 'Signé',
  annule: 'Annulé',
};

export default async function TeamMemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect('/login');

  let detail;
  try {
    detail = await getCommercialDetail(id);
  } catch (e) {
    if (e instanceof Error && e.message === 'Utilisateur introuvable') notFound();
    redirect('/dashboard');
  }

  const { profile, clients, prospects, documents, contracts } = detail;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <Link href="/team" className="hover:text-kf-navy">
          Suivi des commerciaux
        </Link>
        <IconChevronRight className="w-3 h-3" />
        <span className="text-gray-600">{profile.full_name}</span>
      </div>

      <div className="card p-4">
        <h1 className="text-lg font-medium">{profile.full_name || '(sans nom)'}</h1>
        <div className="text-sm text-gray-600 mt-2 space-y-1">
          {profile.phone && (
            <p className="flex items-center gap-1.5">
              <IconPhone className="w-3.5 h-3.5 text-gray-400" /> {profile.phone}
            </p>
          )}
          {profile.email && (
            <p className="flex items-center gap-1.5">
              <IconMail className="w-3.5 h-3.5 text-gray-400" /> {profile.email}
            </p>
          )}
        </div>
      </div>

      <Section title={`Clients (${clients.length})`}>
        {clients.length === 0 && <p className="text-sm text-gray-400">Aucun client assigné.</p>}
        {clients.map((c) => {
          const name = c.company_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
          return (
            <Link key={c.id} href={`/clients/${c.id}`} className="card card-hover block p-3">
              <p className="text-sm font-medium">{name || 'Client sans nom'}</p>
              {c.phone && <p className="text-xs text-gray-500">{c.phone}</p>}
            </Link>
          );
        })}
      </Section>

      <Section title={`Prospects actifs (${prospects.length})`}>
        {prospects.length === 0 && <p className="text-sm text-gray-400">Aucun prospect.</p>}
        {prospects.map((p) => (
          <Link key={p.id} href={`/prospects/${p.id}`} className="card card-hover block p-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Prospect sans nom'}</p>
              {p.next_relance_at && (
                <p className="text-xs text-gray-400">Relance : {new Date(p.next_relance_at).toLocaleDateString('fr-FR')}</p>
              )}
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">{p.status}</span>
          </Link>
        ))}
      </Section>

      <Section title={`Documents (${documents.length})`}>
        {documents.length === 0 && <p className="text-sm text-gray-400">Aucun document.</p>}
        {documents.map((d) => (
          <Link key={d.id} href={`/documents/${d.id}`} className="card card-hover block p-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500">{DOCUMENT_LABELS[d.document_type] ?? d.document_type}</p>
              <p className="text-sm font-medium">{d.document_number ?? '(en attente)'}</p>
              <p className="text-xs text-gray-400">{d.issue_date}</p>
            </div>
            <p className="text-sm font-medium">{formatCFA(Number(d.total_amount))}</p>
          </Link>
        ))}
      </Section>

      <Section title={`Contrats de vente (${contracts.length})`}>
        {contracts.length === 0 && <p className="text-sm text-gray-400">Aucun contrat.</p>}
        {contracts.map((c) => (
          <Link key={c.id} href={`/contracts/${c.id}`} className="card card-hover block p-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{c.contract_number ?? '(en attente)'}</p>
              <p className="text-xs text-gray-400">{formatCFA(Number(c.sale_price))}</p>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
              {CONTRACT_STATUS_LABELS[c.status] ?? c.status}
            </span>
          </Link>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{title}</p>
      {children}
    </div>
  );
}
