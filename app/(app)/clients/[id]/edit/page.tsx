import { getClientFull } from '@/lib/clients/actions';
import { ClientEditForm } from '@/components/clients/client-edit-form';
import Link from 'next/link';
import { IconChevronRight } from '@/components/icons';

export default async function ClientEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await getClientFull(id);
  const clientName = client.company_name || `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <Link href="/clients" className="hover:text-kf-navy">
          Clients
        </Link>
        <IconChevronRight className="w-3 h-3" />
        <Link href={`/clients/${id}`} className="hover:text-kf-navy">
          {clientName || 'Client'}
        </Link>
        <IconChevronRight className="w-3 h-3" />
        <span className="text-gray-600">Modifier</span>
      </div>

      <ClientEditForm
        client={{
          id: client.id,
          clientType: client.client_type,
          firstName: client.first_name ?? '',
          lastName: client.last_name ?? '',
          companyName: client.company_name ?? '',
          phone: client.phone ?? '',
          whatsapp: client.whatsapp ?? '',
          email: client.email ?? '',
          address: client.address ?? '',
          city: client.city ?? '',
          notes: client.notes ?? '',
        }}
      />
    </div>
  );
}
