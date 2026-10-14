import { SkeletonGrid, SkeletonHeader } from '@/components/ui/skeletons';

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement">
      <SkeletonHeader />
      <SkeletonGrid />
    </div>
  );
}
