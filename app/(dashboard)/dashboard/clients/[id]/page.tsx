import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { getClient } from "@/lib/server/clients";
import { getClientAccount } from "@/lib/server/client-account";
import { listClientSales } from "@/lib/server/sales-returns";
import { listClientInvoices } from "@/lib/server/invoices";
import { listReminders } from "@/lib/server/reminders";
import { CLIENT_TRANSACTION_LABELS } from "@/lib/clients/account";
import { REMINDER_STATUS_LABELS } from "@/lib/clients/reminders";
import { formatMad } from "@/lib/invoices/totals";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { ClientBalanceCard } from "@/components/features/clients/client-balance-card";
import { ClientReminderDialog } from "@/components/features/clients/client-reminder-dialog";
import {
  ClientInvoicesTable,
  ClientSalesTable,
} from "@/components/features/clients/client-history-tables";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [client, account] = await Promise.all([getClient(id), getClientAccount(id)]);
  if (!client || !account) notFound();

  const [sales, invoices, reminders] = await Promise.all([
    listClientSales(id),
    listClientInvoices(id),
    listReminders({ clientId: id }),
  ]);

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title={client.name}
        subtitle={client.phone ?? "Aucun téléphone"}
        icon={<Users />}
        backHref="/dashboard/clients"
        backLabel="Clients"
        actions={<ClientReminderDialog clientId={id} />}
      />

      <ClientBalanceCard
        clientId={id}
        solde={account.solde}
        points={account.pointsFidelite}
      />

      <section className="space-y-sp-md">
        <h2 className="font-heading text-base font-bold text-foreground">Historique d&apos;achats</h2>
        <ClientSalesTable sales={sales} />
      </section>

      <section className="space-y-sp-md">
        <h2 className="font-heading text-base font-bold text-foreground">Factures</h2>
        <ClientInvoicesTable invoices={invoices} />
      </section>

      <div className="grid gap-sp-md lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Mouvements du compte</CardTitle>
          </CardHeader>
          <CardContent>
            {account.transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun mouvement enregistré.</p>
            ) : (
              <ul className="space-y-sp-sm text-sm">
                {account.transactions.map((entry) => (
                  <li key={entry.id} className="flex items-start justify-between gap-sp-md border-b pb-sp-sm last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">
                        {CLIENT_TRANSACTION_LABELS[entry.type]}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {entry.date.toLocaleString("fr-FR")}
                        {entry.description ? ` · ${entry.description}` : ""}
                      </p>
                    </div>
                    <span
                      className={
                        entry.montant < 0
                          ? "shrink-0 tabular-nums text-red-700 dark:text-red-300"
                          : "shrink-0 tabular-nums text-emerald-700 dark:text-emerald-300"
                      }
                    >
                      {entry.montant > 0 ? "+" : "−"}
                      {formatMad(Math.abs(entry.montant))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rappels programmés</CardTitle>
          </CardHeader>
          <CardContent>
            {reminders.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun rappel programmé.</p>
            ) : (
              <ul className="space-y-sp-sm text-sm">
                {reminders.map((reminder) => (
                  <li key={reminder.id} className="flex items-start justify-between gap-sp-md border-b pb-sp-sm last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">
                        {reminder.dateRappel.toLocaleDateString("fr-FR")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {reminder.note}
                        {reminder.productName ? ` · ${reminder.productName}` : ""}
                      </p>
                    </div>
                    <Badge variant={reminder.statut === "a_faire" ? "default" : "secondary"}>
                      {REMINDER_STATUS_LABELS[reminder.statut]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
