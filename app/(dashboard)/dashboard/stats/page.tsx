import { BarChart3 } from "lucide-react";
import { requireOwner } from "@/lib/auth/session";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";

export default async function StatsPage() {
  // Redirects assistants back to /dashboard — belt and suspenders on top
  // of the middleware, since detailed financial statistics are
  // owner-only.
  await requireOwner();

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader title="Rapports" icon={<BarChart3 />} />
      <p className="text-muted-foreground">
        Statistiques financières — réservé au titulaire. Le détail des ventes, marges et chiffre
        d&apos;affaires sera ajouté ici.
      </p>
    </div>
  );
}
