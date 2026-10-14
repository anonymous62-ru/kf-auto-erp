import { redirect } from 'next/navigation';
import { getCurrentRole } from '@/lib/permissions';
import { CampaignForm } from '@/components/crm/campaign-form';

export default async function NewCampaignPage() {
  const role = await getCurrentRole();
  if (!['super_admin', 'administrateur', 'manager', 'marketing'].includes(role ?? '')) redirect('/campagnes');
  return (
    <div className="space-y-4">
      <h1 className="page-title">Nouvelle campagne</h1>
      <CampaignForm />
    </div>
  );
}
