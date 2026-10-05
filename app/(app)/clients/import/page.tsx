import Link from 'next/link';
import { ImportWizard } from '@/components/import/import-wizard';
import { IconChevronRight } from '@/components/icons';

export default function ImportClientsPage() {
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <Link href="/clients" className="hover:text-kf-navy">
            Clients
          </Link>
          <IconChevronRight className="h-3 w-3" />
          <span className="text-gray-600">Importer</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">Importer des clients</h1>
        <p className="mt-0.5 text-sm text-gray-500">Depuis un fichier Excel ou CSV, sans ressaisie.</p>
      </div>
      <ImportWizard kind="clients" />
    </div>
  );
}
