import { ClientForm } from '@/components/clients/client-form';
import { can, getCurrentRole } from '@/lib/permissions';

export default async function NewClientPage() {
  const role = await getCurrentRole();
  return (
    <div className="space-y-4">
      <h1 className="page-title">Nouveau contact</h1>
      <ClientForm allowDirectClient={can(role, 'directClient')} />
    </div>
  );
}
