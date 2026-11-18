import { notFound } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { getBordereau } from "@/lib/server/bordereaux";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { BordereauDetailView } from "@/components/features/bordereaux/bordereau-detail-view";

export default async function BordereauPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bordereau = await getBordereau(id);
  if (!bordereau) notFound();

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title={bordereau.numero}
        subtitle={`${bordereau.insurerNom} · ${bordereau.lignes.length} vente${bordereau.lignes.length > 1 ? "s" : ""}`}
        icon={<FileSpreadsheet />}
        backHref="/bordereaux"
        backLabel="Bordereaux"
      />

      <BordereauDetailView bordereau={bordereau} />
    </div>
  );
}
