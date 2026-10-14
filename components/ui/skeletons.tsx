// Squelettes de chargement (affichés par les fichiers loading.tsx).
export function SkeletonHeader() {
  return (
    <div className="mb-5 space-y-2">
      <div className="skeleton h-6 w-48" />
      <div className="skeleton h-4 w-72" />
    </div>
  );
}

export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card space-y-2 p-4">
          <div className="skeleton h-3.5 w-24" />
          <div className="skeleton h-7 w-32" />
          <div className="skeleton h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-wrap">
      <div className="flex gap-4 border-b border-gray-200 bg-gray-50 px-3 py-2.5">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="skeleton h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b border-gray-100 px-3 py-3.5 last:border-b-0">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className={`skeleton h-3.5 flex-1 ${c === 0 ? 'max-w-[40%]' : ''}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card overflow-hidden">
          <div className="skeleton aspect-[16/10] w-full rounded-none" />
          <div className="space-y-2 p-3">
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton h-3.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
