import { SkeletonHeader, SkeletonStats, SkeletonTable } from '@/components/ui/skeletons';

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement">
      <SkeletonHeader />
      <SkeletonStats />
      <SkeletonTable rows={6} />
    </div>
  );
}
