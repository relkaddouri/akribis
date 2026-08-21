import { FileSpreadsheet } from "lucide-react";
import { listOrganismesActifs } from "@/lib/server/organismes";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { NouveauBordereauForm } from "@/components/features/bordereaux/nouveau-bordereau-form";

export const metadata = { title: "Nouveau bordereau — Akribis" };

export default async function NouveauBordereauPage() {
  const organismes = await listOrganismesActifs();

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Nouveau bordereau"
        subtitle="Choisissez un organisme et une période ; les ventes à réclamer sont listées automatiquement."
        icon={<FileSpreadsheet />}
        backHref="/bordereaux"
        backLabel="Bordereaux"
      />

      <NouveauBordereauForm organismes={organismes} />
    </div>
  );
}
