<<<<<<< Updated upstream
export default function HomeLoading() {
  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex flex-col items-center p-4 pt-16 md:p-8 md:pt-16 overflow-x-hidden">
      {/* Top-right pill skeleton */}
      <div className="fixed top-4 right-4 z-50 flex items-center gap-1 bg-white/60 dark:bg-gray-800/60 backdrop-blur-md px-3 py-2 rounded-full border border-gray-100/50 dark:border-gray-700/50 shadow-sm">
        <div className="w-6 h-5 rounded bg-muted/60" style={{ animation: 'skeleton-pulse 1.5s ease-in-out infinite' }} />
        <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />
        <div className="w-5 h-5 rounded-full bg-muted/60" style={{ animation: 'skeleton-pulse 1.5s ease-in-out infinite 0.15s' }} />
      </div>

      {/* Hero skeleton */}
      <div className="relative z-20 w-full max-w-[800px] flex flex-col items-center mt-[10vh]">
        {/* Title skeleton */}
        <div
          className="h-8 md:h-10 w-72 md:w-96 rounded-lg bg-gradient-to-r from-purple-200/50 via-violet-200/50 to-indigo-200/50 dark:from-purple-800/30 dark:via-violet-800/30 dark:to-indigo-800/30 mb-3"
          style={{ animation: 'skeleton-pulse 1.5s ease-in-out infinite' }}
        />

        {/* Slogan skeleton */}
        <div
          className="h-4 w-48 rounded bg-muted/40 mb-8"
          style={{ animation: 'skeleton-pulse 1.5s ease-in-out infinite 0.2s' }}
        />

        {/* Input area skeleton */}
        <div className="w-full rounded-2xl border border-border/60 bg-white/80 dark:bg-slate-900/80 p-4 space-y-4">
          {/* Greeting skeleton */}
          <div className="flex items-center gap-3">
            <div
              className="size-8 rounded-full bg-muted/60"
              style={{ animation: 'skeleton-pulse 1.5s ease-in-out infinite 0.1s' }}
            />
            <div
              className="h-4 w-32 rounded bg-muted/50"
              style={{ animation: 'skeleton-pulse 1.5s ease-in-out infinite 0.2s' }}
            />
          </div>

          {/* Textarea skeleton */}
          <div
            className="w-full h-[140px] rounded-lg bg-muted/30"
            style={{ animation: 'skeleton-pulse 1.5s ease-in-out infinite 0.3s' }}
          />

          {/* Toolbar skeleton */}
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-7 w-16 rounded-full bg-muted/40"
                  style={{ animation: `skeleton-pulse 1.5s ease-in-out infinite ${0.1 * i}s` }}
                />
              ))}
            </div>
            <div className="flex-1" />
            <div
              className="h-8 w-28 rounded-lg bg-muted/50"
              style={{ animation: 'skeleton-pulse 1.5s ease-in-out infinite 0.5s' }}
            />
          </div>
        </div>
      </div>
=======
export default function Loading() {
  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex flex-col items-center justify-center p-4">
      {/* Animated skeleton that matches the homepage layout */}
      <div className="w-full max-w-[800px] flex flex-col items-center gap-6 animate-pulse">
        {/* Title skeleton */}
        <div className="h-8 md:h-10 w-56 md:w-72 rounded-xl bg-gradient-to-r from-purple-200/40 via-violet-200/50 to-indigo-200/40 dark:from-purple-800/30 dark:via-violet-800/40 dark:to-indigo-800/30" />

        {/* Slogan skeleton */}
        <div className="h-4 w-40 rounded-lg bg-muted/40" />

        {/* Input card skeleton */}
        <div className="w-full rounded-2xl border border-border/40 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl shadow-xl shadow-black/[0.02] p-4 space-y-4">
          {/* Greeting row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-full bg-muted/50" />
              <div className="h-4 w-28 rounded-md bg-muted/40" />
            </div>
            <div className="flex items-center gap-1.5">
              <div className="size-6 rounded-full bg-muted/40" />
              <div className="size-6 rounded-full bg-muted/40" />
              <div className="size-6 rounded-full bg-muted/40" />
            </div>
          </div>

          {/* Textarea skeleton */}
          <div className="space-y-2">
            <div className="h-3 w-full rounded bg-muted/30" />
            <div className="h-3 w-4/5 rounded bg-muted/25" />
            <div className="h-3 w-2/3 rounded bg-muted/20" />
          </div>

          {/* Toolbar skeleton */}
          <div className="flex items-center gap-2 pt-2">
            <div className="h-7 w-20 rounded-full bg-muted/40" />
            <div className="h-7 w-7 rounded-full bg-muted/30" />
            <div className="h-7 w-7 rounded-full bg-muted/30" />
            <div className="flex-1" />
            <div className="h-8 w-24 rounded-lg bg-muted/40" />
          </div>
        </div>
      </div>

      {/* Subtle shimmer overlay */}
      <div className="fixed inset-0 pointer-events-none z-50">
        <div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent"
          style={{
            animation: 'shimmer 2s infinite',
          }}
        />
      </div>
>>>>>>> Stashed changes
    </div>
  );
}
