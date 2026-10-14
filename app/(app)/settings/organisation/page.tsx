import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMyOrganization } from '@/lib/organization/actions';
import { OrganizationLogoUpload } from '@/components/settings/organization-logo-upload';
import { OrganizationInfoForm } from '@/components/settings/organization-info-form';
import { MonthlyTargetForm } from '@/components/settings/monthly-target-form';

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

  // La direction (dont le manager) règle l'objectif mensuel ; seuls
  // l'administrateur et le super admin modifient le reste de la fiche.
  if (!profile || !['super_admin', 'administrateur', 'manager'].includes(profile.role)) {
    redirect('/dashboard');
  }

  const organization = await getMyOrganization();
  if (!organization) {
    return (
      <div className="text-sm text-gray-500 space-y-2">
        <p>Organisation introuvable.</p>
        <p className="text-xs text-gray-400">
          Cela signifie que la base de données bloque la lecture de votre organisation
          (policy de sécurité manquante) ou que votre compte n&apos;est rattaché à aucune
          organisation. Exécutez la migration <code>0014_organizations_rls_fix.sql</code>{' '}
          dans Supabase (SQL Editor), puis rafraîchissez cette page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="page-title">Organisation</h1>
      <MonthlyTargetForm initial={Number(organization.monthly_target ?? 0)} />
      {profile.role !== 'manager' && (
        <>
          <OrganizationLogoUpload
            organizationId={organization.id}
            currentLogoUrl={organization.logo_url}
            organizationName={organization.name}
          />
          <OrganizationInfoForm organization={organization} />
        </>
      )}
    </div>
  );
}
