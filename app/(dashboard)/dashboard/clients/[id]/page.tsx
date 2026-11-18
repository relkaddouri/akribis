import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { getClient } from "@/lib/server/clients";
import { getClientAccount } from "@/lib/server/client-account";
import { listClientSales } from "@/lib/server/sales-returns";
import { listClientInvoices } from "@/lib/server/invoices";
import { listReminders } from "@/lib/server/reminders";
import { listOrganismesActifs } from "@/lib/server/organismes";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { ClientBalanceCard } from "@/components/features/clients/client-balance-card";
import { ClientDetailsSections } from "@/components/features/clients/client-details-sections";
import { ClientEditDialog } from "@/components/features/clients/client-edit-dialog";
import { ClientHistoryTabs } from "@/components/features/clients/client-history-tabs";
import { ClientReminderDialog } from "@/components/features/clients/client-reminder-dialog";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [client, account] = await Promise.all([getClient(id), getClientAccount(id)]);
  if (!client || !account) notFound();

  const [sales, invoices, reminders, organismes] = await Promise.all([
    listClientSales(id),
    listClientInvoices(id),
    listReminders({ clientId: id }),
    listOrganismesActifs(),
  ]);

  // L'affiliation peut pointer un organisme désactivé depuis : on garde le
  // nom lisible plutôt que de faire disparaître la ligne de la fiche.
  const organismeNom = organismes.find((o) => o.id === client.insurerId)?.nom ?? null;

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title={client.name}
        subtitle={client.phone ?? "Aucun téléphone"}
        icon={<Users />}
        backHref="/dashboard/clients"
        backLabel="Clients"
        actions={
          <div className="flex flex-wrap items-center gap-sp-sm">
            <ClientEditDialog client={client} organismes={organismes} />
            <ClientReminderDialog clientId={id} />
          </div>
        }
      />

      <ClientBalanceCard
        clientId={id}
        solde={account.solde}
        points={account.pointsFidelite}
        plafondCredit={client.plafondCredit}
      />

      <ClientDetailsSections client={client} organismeNom={organismeNom} />

      <ClientHistoryTabs
        sales={sales}
        invoices={invoices}
        transactions={account.transactions}
        reminders={reminders}
      />
    </div>
  );
}

