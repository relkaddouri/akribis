import Link from "next/link";
import { FileSpreadsheet, Plus } from "lucide-react";
import { listBordereaux } from "@/lib/server/bordereaux";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { BordereauxTable } from "@/components/features/bordereaux/bordereaux-table";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Bordereaux — Akribis" };

export default async function BordereauxPage() {
  const bordereaux = await listBordereaux();

  const ouverts = bordereaux.filter((b) => b.statut !== "CLOTURE");
  const enJeu = ouverts.reduce((somme, b) => somme + b.montantReclame, 0);

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Bordereaux"
        subtitle={
          bordereaux.length === 0
            ? "Les récapitulatifs adressés aux organismes de tiers payant"
            : `${bordereaux.length} bordereau${bordereaux.length > 1 ? "x" : ""} · ` +
              `${enJeu.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD en attente de règlement`
        }
        icon={<FileSpreadsheet />}
        actions={
          <Button asChild size="sm">
            <Link href="/bordereaux/nouveau">
              <Plus /> Nouveau bordereau
            </Link>
          </Button>
        }
      />

      <BordereauxTable bordereaux={bordereaux} />
    </div>
  );
}
