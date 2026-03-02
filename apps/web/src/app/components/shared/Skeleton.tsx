export function Skeleton({ className = '', ...props }: { className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`skeleton ${className}`} {...props} />
}

export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: i === lines - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  )
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`card p-5 ${className}`}>
      <Skeleton className="h-4 w-32 mb-3" />
      <SkeletonText lines={3} />
    </div>
  )
}
