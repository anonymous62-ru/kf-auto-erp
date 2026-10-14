import { SkeletonHeader, SkeletonTable } from '@/components/ui/skeletons';

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement">
      <SkeletonHeader />
      <SkeletonTable />
    </div>
  );
}
