import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listCampaigns } from '@/lib/crm/campaigns';
import { campaignStatus, channelLabel } from '@/lib/crm/labels';
import { formatCFA } from '@/lib/documents/calculations';
import { clientDisplayName } from '@/lib/documents/labels';
import { getCurrentRole } from '@/lib/permissions';
import { CampaignForm } from '@/components/crm/campaign-form';

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const role = await getCurrentRole();
  if (!['super_admin', 'administrateur', 'manager', 'marketing', 'admin_ventes', 'chef_service'].includes(role ?? '')) redirect('/dashboard');
  const canWrite = ['super_admin', 'administrateur', 'manager', 'marketing'].includes(role ?? '');
  const { campaigns } = await listCampaigns(true);
  const c = campaigns.find((x) => x.id === id);
  if (!c) notFound();

  const supabase = await createClient();
  const { data: leads } = await supabase
    .from('prospects')
    .select('id, company_name, first_name, last_name, status, created_at')
    .eq('campaign_id', id)
    .order('created_at', { ascending: false })
    .limit(200);

  const st = campaignStatus(c.status);
  const n = c.stats?.leads ?? 0;
  const tiles = [
    { label: 'Leads générés', value: String(n) },
    { label: 'Coût par lead', value: n ? formatCFA(c.spent / n) : '-' },
    { label: 'Leads transformés', value: `${c.stats?.leads_converted ?? 0}${n ? ` (${Math.round(((c.stats?.leads_converted ?? 0) / n) * 100)} %)` : ''}` },
    { label: 'Affaires gagnées', value: `${c.stats?.deals_won ?? 0} · ${formatCFA(c.stats?.won_amount ?? 0)}` },
    { label: 'Facturé à ces contacts', value: formatCFA(c.stats?.invoiced_amount ?? 0) },
    { label: 'Dépensé / budget', value: `${formatCFA(c.spent)} / ${formatCFA(c.budget)}` },
  ];

  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/campagnes" className="text-sm text-gray-500 hover:text-kf-navy">
        ← Campagnes
      </Link>
      <div className="card p-4">
        <p className="text-xs text-gray-500">
          {channelLabel(c.channel)} · {new Date(`${c.start_date}T00:00:00`).toLocaleDateString('fr-FR')}
          {c.end_date ? ` au ${new Date(`${c.end_date}T00:00:00`).toLocaleDateString('fr-FR')}` : ''}
        </p>
        <h1 className="page-title">{c.name}</h1>
        <p className="mt-1">
          <span className={st.badge}>{st.label}</span>
        </p>
        {c.objective && <p className="mt-2 text-sm text-gray-600">Objectif : {c.objective}</p>}
      </div>

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="card p-3">
            <p className="text-xs text-gray-500">{t.label}</p>
            <p className="mt-1 text-sm font-semibold text-gray-900">{t.value}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <p className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100">Leads de la campagne</p>
        {(leads ?? []).length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">
            Aucun lead rattaché pour l&apos;instant{n > 0 ? ' parmi ceux que vous pouvez voir' : ''}.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {(leads ?? []).map((l) => (
              <li key={l.id}>
                <Link href={`/prospects/${l.id}`} className="flex justify-between gap-3 px-4 py-2.5 text-sm hover:bg-gray-50">
                  <span>{clientDisplayName(l)}</span>
                  <span className="text-xs text-gray-500">{new Date(l.created_at).toLocaleDateString('fr-FR')}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canWrite && (
        <CampaignForm
          campaignId={c.id}
          initial={{
            name: c.name,
            channel: c.channel,
            startDate: c.start_date,
            endDate: c.end_date ?? '',
            budget: c.budget,
            spent: c.spent,
            objective: c.objective ?? '',
            status: c.status,
            notes: c.notes ?? '',
          }}
        />
      )}
    </div>
  );
}
