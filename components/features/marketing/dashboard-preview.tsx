/**
 * Decorative stand-in for a dashboard screenshot: a stylized browser
 * window built from the same design tokens as the real app, rather than
 * a real screenshot that would go stale (or leak sample data) every time
 * the dashboard's UI changes.
 */
export function DashboardPreview() {
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-card">
      <div className="flex items-center gap-1.5 border-b border-border/60 px-4 py-3">
        <span className="size-2.5 rounded-full bg-red-300" />
        <span className="size-2.5 rounded-full bg-amber-300" />
        <span className="size-2.5 rounded-full bg-emerald-300" />
      </div>

      <div className="flex bg-background">
        <div className="hidden w-32 shrink-0 space-y-2 border-r border-border/60 bg-card p-3 sm:block">
          <div className="h-2 w-16 rounded-full bg-emerald-200" />
          <div className="mt-4 space-y-1.5">
            <div className="h-6 rounded-lg bg-muted" />
            <div className="h-6 rounded-lg bg-emerald-50" />
            <div className="h-6 rounded-lg bg-muted" />
            <div className="h-6 rounded-lg bg-muted" />
          </div>
        </div>

        <div className="flex-1 space-y-3 p-4">
          <div className="grid grid-cols-3 gap-2">
            {["8 473,50", "0", "1"].map((value, i) => (
              <div key={i} className="rounded-xl bg-card p-2.5 shadow-soft">
                <div className="h-1.5 w-10 rounded-full bg-muted" />
                <p className="mt-2 text-sm font-semibold text-foreground sm:text-base">{value}</p>
              </div>
            ))}
          </div>

          <div className="space-y-2 rounded-xl bg-card p-3 shadow-soft">
            <div className="h-1.5 w-20 rounded-full bg-muted" />
            {[80, 55, 30].map((width, i) => (
              <div key={i} className="h-1.5 rounded-full bg-muted">
                <div className="h-full rounded-full bg-emerald-400" style={{ width: `${width}%` }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
