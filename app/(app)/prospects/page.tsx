import Link from 'next/link';
import { getProspects } from '@/lib/prospects/actions';
import { ProspectList } from '@/components/prospects/prospect-list';

export default async function ProspectsPage() {
  const prospects = await getProspects();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Prospects</h1>
        <Link href="/prospects/new" className="text-sm bg-kf-navy text-white rounded-md px-3 py-1.5">
          + Nouveau
        </Link>
      </div>
      <ProspectList initialProspects={prospects} />
    </div>
  );
}
