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
    </div>
  );
}
