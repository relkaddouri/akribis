import { ScrollText } from "lucide-react";
import { listEventLog } from "@/lib/server/audit";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { JournalTable } from "@/components/features/admin/journal-table";

export const metadata = { title: "Journal d'audit — Akribis" };

/**
 * Le journal d'audit, côté Admin.
 *
 * `/admin/*` est déjà couvert par ADMIN_ONLY_PREFIXES au middleware et par
 * le `requireAdmin()` du layout ; `listEventLog()` le revérifie de son
 * côté, une action serveur étant joignable en POST sans traverser ni l'un
 * ni l'autre.
 */
export default async function AdminJournalPage() {
  const entrees = await listEventLog();

  const acteurs = new Set(entrees.map((e) => e.acteurEmail)).size;

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Journal d'audit"
        subtitle={
          entrees.length === 0
            ? "Chaque action administrative sur le catalogue, conservée définitivement"
            : `${entrees.length} action${entrees.length > 1 ? "s" : ""} · ${acteurs} administrateur${acteurs > 1 ? "s" : ""}`
        }
        icon={<ScrollText />}
        space="admin"
      />

      <JournalTable entrees={entrees} />
    </div>
  );
}
