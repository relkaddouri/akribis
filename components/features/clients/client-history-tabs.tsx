"use client";

import { Bell, FileText, PackageOpen, ReceiptText, Wallet } from "lucide-react";
import type { ClientAccountTransaction } from "@/lib/server/client-account";
import type { ReminderListItem } from "@/lib/server/reminders";
import type { InvoiceListItem } from "@/lib/server/invoices";
import { CLIENT_TRANSACTION_LABELS } from "@/lib/clients/account";
import { REMINDER_STATUS_LABELS } from "@/lib/clients/reminders";
import { formatMad } from "@/lib/invoices/totals";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ClientInvoicesTable,
  ClientSalesTable,
  type ClientSaleRow,
} from "@/components/features/clients/client-history-tables";

/**
 * Les quatre historiques de la fiche client, en onglets.
 *
 * Empilés, ils faisaient défiler la page sur plus de deux écrans avant
 * d'arriver aux rappels — et les trois premiers sont rarement ceux qu'on
 * vient consulter. L'identité, le solde et le plafond restent au-dessus,
 * eux : ce sont les seuls qu'on lit à chaque ouverture.
 *
 * Le compteur sur chaque onglet évite d'avoir à l'ouvrir pour découvrir
 * qu'il est vide.
 */

/**
 * Le compteur d'un onglet. En gris plutôt qu'en pastille : c'est un
 * complément au libellé, pas une notification qui réclame l'attention.
 * Même forme que components/features/suppliers/supplier-detail-view.tsx.
 */
function TabCount({ value }: { value: number }) {
  // Pas d'`aria-hidden` : « Factures, 3 » est exactement ce qu'il faut à
  // qui ne voit pas l'écran pour décider s'il vaut la peine de l'ouvrir.
  return <span className="text-xs tabular-nums text-muted-foreground">{value}</span>;
}

/**
 * Le vide des deux onglets qui ne passent pas par `DataTable`, calqué sur
 * le sien : même icône, même hauteur, même hiérarchie titre/explication.
 * Quatre onglets côte à côte rendent une différence de traitement du vide
 * bien plus visible qu'elle ne l'était quand les sections s'empilaient.
 */
function Vide({ titre, description }: { titre: string; description: string }) {
  return (
    <div className="rounded-xl bg-card shadow-card">
      <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
        <PackageOpen className="size-8 opacity-40" strokeWidth={1.5} />
        <p className="text-sm font-medium text-foreground">{titre}</p>
        <p className="text-sm">{description}</p>
      </div>
    </div>
  );
}

/** Le cadre des deux listes, identique à celui que `DataTable` se donne. */
function Liste({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-card p-sp-md shadow-card">
      <ul className="space-y-sp-sm text-sm">{children}</ul>
    </div>
  );
}

export function ClientHistoryTabs({
  sales,
  invoices,
  transactions,
  reminders,
}: {
  sales: ClientSaleRow[];
  invoices: InvoiceListItem[];
  transactions: ClientAccountTransaction[];
  reminders: ReminderListItem[];
}) {
  return (
    <Tabs defaultValue="achats" className="gap-sp-md">
      <TabsList>
        <TabsTrigger value="achats">
          <ReceiptText aria-hidden />
          Historique d&apos;achats
          <TabCount value={sales.length} />
        </TabsTrigger>
        <TabsTrigger value="factures">
          <FileText aria-hidden />
          Factures
          <TabCount value={invoices.length} />
        </TabsTrigger>
        <TabsTrigger value="mouvements">
          <Wallet aria-hidden />
          Mouvements du compte
          <TabCount value={transactions.length} />
        </TabsTrigger>
        <TabsTrigger value="rappels">
          <Bell aria-hidden />
          Rappels programmés
          <TabCount value={reminders.length} />
        </TabsTrigger>
      </TabsList>

      <TabsContent value="achats">
        <ClientSalesTable sales={sales} />
      </TabsContent>

      <TabsContent value="factures">
        <ClientInvoicesTable invoices={invoices} />
      </TabsContent>

      <TabsContent value="mouvements">
        {transactions.length === 0 ? (
          <Vide
            titre="Aucun mouvement"
            description="Les ventes à crédit et les paiements de ce client apparaîtront ici."
          />
        ) : (
          <Liste>
            {transactions.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start justify-between gap-sp-md border-b pb-sp-sm last:border-0 last:pb-0"
              >
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
          </Liste>
        )}
      </TabsContent>

      <TabsContent value="rappels">
        {reminders.length === 0 ? (
          <Vide
            titre="Aucun rappel"
            description="Programmez un rappel pour recontacter ce client."
          />
        ) : (
          <Liste>
            {reminders.map((reminder) => (
              <li
                key={reminder.id}
                className="flex items-start justify-between gap-sp-md border-b pb-sp-sm last:border-0 last:pb-0"
              >
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
          </Liste>
        )}
      </TabsContent>
    </Tabs>
  );
}
