import { Landmark } from "lucide-react";
import { getEtatCaisse, listSessionsCaisse, peutCloturer } from "@/lib/server/caisse";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { CaisseView } from "@/components/features/caisse/caisse-view";

export const metadata = { title: "Journal Z — Akribis" };

export default async function CaissePage() {
  const [etat, sessions, cloture] = await Promise.all([
    getEtatCaisse(),
    listSessionsCaisse(),
    peutCloturer(),
  ]);

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Journal Z"
        subtitle="Ouverture et clôture de caisse, et l'archive des journées passées"
        icon={<Landmark />}
      />
      <CaisseView etat={etat} sessions={sessions} cloture={cloture} />
    </div>
  );
}
