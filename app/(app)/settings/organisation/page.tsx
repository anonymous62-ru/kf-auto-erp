import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyOrganization } from '@/lib/organization/actions';
import { OrganizationLogoUpload } from '@/components/settings/organization-logo-upload';
import { OrganizationInfoForm } from '@/components/settings/organization-info-form';

export default async function OrganizationSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user?.id ?? '')
    .single();

  if (!profile || !['super_admin', 'administrateur'].includes(profile.role)) {
    redirect('/dashboard');
  }

  const organization = await getMyOrganization();
  if (!organization) {
    return <p className="text-sm text-gray-500">Organisation introuvable.</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium">Organisation</h1>
      <OrganizationLogoUpload
        organizationId={organization.id}
        currentLogoUrl={organization.logo_url}
        organizationName={organization.name}
      />
      <OrganizationInfoForm organization={organization} />
    </div>
  );
}
