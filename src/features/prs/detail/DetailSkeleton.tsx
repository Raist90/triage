export function DetailSkeleton() {
  return (
    <div aria-hidden="true" className="p-4">
      <div className="h-5 w-2/3 animate-pulse rounded-sm bg-surface" />
      <div className="mt-3 h-3 w-1/3 animate-pulse rounded-sm bg-surface" />
      <div className="mt-6 h-3 w-1/2 animate-pulse rounded-sm bg-surface" />
      <div className="mt-3 h-3 w-2/3 animate-pulse rounded-sm bg-surface" />
      <div className="mt-3 h-3 w-1/2 animate-pulse rounded-sm bg-surface" />
    </div>
  );
}
