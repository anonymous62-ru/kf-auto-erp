import { redirect } from 'next/navigation';
import { getCurrentProfile } from '@/lib/permissions';
import { DEPARTMENTS, DIRECTION_ROLES, managedDepartment, type Department } from '@/lib/users/roles';
import { RequestForm } from '@/components/users/request-form';

export default async function NewUserRequestPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  const isDirection = DIRECTION_ROLES.includes(profile.role);
  const myDepartment = managedDepartment(profile.role, profile.department);
  const departments: Department[] = isDirection ? DEPARTMENTS.map((d) => d.value) : myDepartment ? [myDepartment] : [];
  if (departments.length === 0) redirect('/dashboard');

  return (
    <div className="space-y-4">
      <h1 className="page-title">Demander une inscription</h1>
      <p className="text-sm text-gray-500 max-w-xl">
        La direction (DG, manager) reçoit la demande et crée le compte. Vous serez prévenu dans les notifications.
      </p>
      <RequestForm departments={departments} />
    </div>
  );
}
