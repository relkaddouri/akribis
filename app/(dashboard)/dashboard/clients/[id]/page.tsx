import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { getClient } from "@/lib/server/clients";
import { PurchaseHistory } from "@/components/features/clients/purchase-history";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await getClient(id);
  if (!client) notFound();

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title={client.name}
        subtitle={client.phone ?? "Aucun téléphone"}
        icon={<Users />}
        backHref="/dashboard/clients"
        backLabel="Clients"
      />

      <section className="space-y-sp-md">
        <h2 className="font-heading text-base font-bold text-foreground">Historique des achats</h2>
        <PurchaseHistory purchases={client.purchases} />
      </section>
    </div>
  );
}
