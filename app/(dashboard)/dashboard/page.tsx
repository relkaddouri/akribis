import { LayoutDashboard } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getDashboardStats } from "@/lib/server/dashboard";
import { getPeriodStats } from "@/lib/server/dashboard-periods";
import { isPeriod, PERIOD_LABELS, type Period } from "@/lib/dashboard/periods";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { PeriodSelect } from "@/components/features/dashboard/period-select";
import { StatCard } from "@/components/features/dashboard/stat-card";
import { TopProductsChart } from "@/components/features/dashboard/top-products-chart";

const DEFAULT_PERIOD: Period = "mois";

function formatMad(amount: number): string {
  return `${amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>;
}) {
  const { periode } = await searchParams;
  const period = isPeriod(periode) ? periode : DEFAULT_PERIOD;

  const [user, stats, periodStats] = await Promise.all([
    requireUser(),
    getDashboardStats(),
    getPeriodStats(period),
  ]);

  const comparisonLabel = `vs ${PERIOD_LABELS[period].toLowerCase()} précédents`;
  const { marginCoverage } = periodStats;
  const marginIsPartial =
    marginCoverage.totalLines > 0 && marginCoverage.linesWithCost < marginCoverage.totalLines;

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader title="Tableau de bord" icon={<LayoutDashboard />} />

      <p className="text-muted-foreground">Bienvenue {user.name ?? user.email}.</p>

      <section className="space-y-sp-md">
        <div className="flex flex-wrap items-center justify-between gap-sp-md">
          <h2 className="font-heading text-base font-bold text-foreground">Activité de la période</h2>
          <PeriodSelect value={period} />
        </div>

        <div className="grid gap-sp-md sm:grid-cols-3">
          <StatCard
            label="Chiffre d'affaires"
            value={formatMad(periodStats.revenue.current)}
            variation={periodStats.revenue.variation}
            comparisonLabel={comparisonLabel}
          />
          <StatCard
            label="Marge brute"
            value={formatMad(periodStats.margin.current)}
            variation={periodStats.margin.variation}
            comparisonLabel={comparisonLabel}
            hint={
              marginIsPartial
                ? `Calculée sur ${marginCoverage.linesWithCost}/${marginCoverage.totalLines} lignes — prix d'achat manquant sur les autres`
                : "Prix de vente moins prix d'achat des produits vendus"
            }
          />
          <StatCard
            label="Ventes"
            value={String(periodStats.salesCount.current)}
            variation={periodStats.salesCount.variation}
            comparisonLabel={comparisonLabel}
          />
        </div>
      </section>

      <section className="space-y-sp-md">
        {/* No variation on these three: they describe the shelves right
            now, and the schema keeps no historical snapshot to compare a
            past period against. See the note in dashboard-periods.ts. */}
        <h2 className="font-heading text-base font-bold text-foreground">État actuel du stock</h2>

        <div className="grid gap-sp-md sm:grid-cols-3">
          <StatCard label="Valeur totale du stock" value={formatMad(stats.totalStockValue)} />
          <StatCard
            label="Produits en rupture"
            value={String(stats.outOfStockCount)}
            hint="Quantité en stock à zéro"
          />
          <StatCard
            label="Proches de la péremption"
            value={String(stats.expiringCount)}
            hint="Dans les 30 prochains jours"
          />
        </div>
      </section>

      <TopProductsChart products={stats.topProducts} />
    </div>
  );
}
