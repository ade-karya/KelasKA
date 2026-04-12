export default function ClassroomLoading() {
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* Header skeleton */}
      <div className="h-12 border-b border-border/40 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm flex items-center px-4 gap-3 shrink-0">
        <div
          className="h-6 w-6 rounded bg-muted/50"
          style={{ animation: 'skeleton-pulse 1.5s ease-in-out infinite' }}
        />
        <div
          className="h-4 w-48 rounded bg-muted/40"
          style={{ animation: 'skeleton-pulse 1.5s ease-in-out infinite 0.1s' }}
        />
        <div className="flex-1" />
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-7 w-7 rounded-lg bg-muted/40"
              style={{ animation: `skeleton-pulse 1.5s ease-in-out infinite ${0.1 * i}s` }}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar skeleton */}
        <div className="hidden md:flex w-56 border-r border-border/40 bg-white/40 dark:bg-slate-900/40 flex-col p-3 gap-2 shrink-0">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg p-2"
            >
              <div
                className="size-10 rounded-lg bg-muted/40 shrink-0"
                style={{ animation: `skeleton-pulse 1.5s ease-in-out infinite ${0.08 * i}s` }}
              />
              <div className="flex-1 space-y-1.5 min-w-0">
                <div
                  className="h-3 w-full rounded bg-muted/40"
                  style={{ animation: `skeleton-pulse 1.5s ease-in-out infinite ${0.08 * i + 0.1}s` }}
                />
                <div
                  className="h-2.5 w-2/3 rounded bg-muted/30"
                  style={{ animation: `skeleton-pulse 1.5s ease-in-out infinite ${0.08 * i + 0.2}s` }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Main content skeleton */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div
              className="size-10 border-2 border-violet-300/60 dark:border-violet-500/40 border-t-transparent rounded-full animate-spin mx-auto"
            />
            <div
              className="h-3.5 w-28 rounded bg-muted/40 mx-auto"
              style={{ animation: 'skeleton-pulse 1.5s ease-in-out infinite' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
