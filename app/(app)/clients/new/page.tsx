import { ClientForm } from '@/components/clients/client-form';

export default function NewClientPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium">Nouveau client</h1>
      <ClientForm />
    </div>
  );
}
