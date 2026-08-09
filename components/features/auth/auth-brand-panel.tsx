/**
 * Decorative brand panel for the two-column auth layout. Emerald-only
 * gradient built from the existing palette (emerald-600/500/400) — no
 * new colors, per the design system's "no general-purpose orange accent"
 * rule (orange stays reserved for the second chart series).
 */
export function AuthBrandPanel() {
  return (
    <aside className="relative m-3 hidden w-[45%] shrink-0 flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-emerald-500 to-emerald-400 p-10 text-white shadow-card lg:flex">
      <div className="flex items-center gap-3 text-xs font-semibold tracking-[0.2em] text-emerald-50/90">
        <span className="h-px w-8 bg-emerald-50/50" />
        AKRIBIS
      </div>

      <div>
        <h2 className="text-3xl leading-tight sm:text-4xl">
          Gérez votre stock,
          <br />
          sans effort.
        </h2>
        <p className="mt-4 max-w-xs text-emerald-50/90">
          La solution de gestion pensée pour les pharmacies marocaines — simple, et qui fonctionne même
          hors ligne.
        </p>

        <div className="mt-8 flex items-baseline gap-2 border-t border-white/20 pt-6">
          <span className="text-2xl font-semibold">+50</span>
          <span className="text-sm text-emerald-50/80">pharmacies nous font confiance</span>
        </div>
      </div>
    </aside>
  );
}
