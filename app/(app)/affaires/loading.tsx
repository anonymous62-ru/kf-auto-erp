import { SkeletonHeader } from '@/components/ui/skeletons';

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Chargement">
      <SkeletonHeader />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
            <div className="skeleton h-4 w-20" />
            {Array.from({ length: 3 }).map((__, j) => (
              <div key={j} className="skeleton h-20 w-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
