"use client";

import { useState } from "react";
import Link from "next/link";
import { Receipt, RotateCcw } from "lucide-react";
import type { SaleDetail } from "@/lib/server/sales-returns";
import { remainingReturnable } from "@/lib/sales/returns";
import { formatMad } from "@/lib/invoices/totals";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { SaleReturnBadge } from "@/components/features/sales/sale-return-badge";
import { SaleReturnDialog } from "@/components/features/sales/sale-return-dialog";

const PAYMENT_LABELS: Record<SaleDetail["paymentMethod"], string> = {
  CASH: "Espèces",
  CARD: "Carte",
  CREDIT: "Crédit client",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  );
}

export function SaleDetailView({ sale }: { sale: SaleDetail }) {
  const [returnOpen, setReturnOpen] = useState(false);
  const hasReturnable = sale.lines.some((line) => remainingReturnable(line) > 0);

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title={sale.reference}
        subtitle={sale.createdAt.toLocaleString("fr-FR")}
        icon={<Receipt />}
        backHref="/ventes"
        backLabel="Ventes"
        actions={
          <div className="flex items-center gap-sp-sm">
            <SaleReturnBadge status={sale.returnStatus} />
            <Button onClick={() => setReturnOpen(true)} disabled={!hasReturnable}>
              <RotateCcw className="size-4" />
              Effectuer un retour
            </Button>
          </div>
        }
      />

      <div className="grid gap-sp-md lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Produits vendus</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produit</TableHead>
                  <TableHead className="text-right">Qté</TableHead>
                  <TableHead className="text-right">Retourné</TableHead>
                  <TableHead className="text-right">P.U.</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sale.lines.map((line) => (
                  <TableRow key={line.saleItemId}>
                    <TableCell className="font-medium text-foreground">
                      {line.productName}
                      {line.remboursable && (
                        <Badge variant="secondary" className="ml-sp-sm">
                          Remboursable
                          {line.baseRemboursement !== null
                            ? ` · base ${line.baseRemboursement.toFixed(2)}`
                            : ""}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.returnedQuantity > 0 ? (
                        <span className="text-amber-700 dark:text-amber-300">
                          {line.returnedQuantity}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.unitPrice.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.lineTotal.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="mt-sp-md flex justify-end border-t pt-sp-sm">
              <span className="font-heading text-base font-bold text-foreground">
                Total : {formatMad(sale.totalAmount)}
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-sp-md">
          <Card>
            <CardHeader>
              <CardTitle>Informations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-sp-md">
              <Field label="Client" value={sale.clientName ?? "Client de passage"} />
              {sale.clientPhone && <Field label="Téléphone" value={sale.clientPhone} />}
              <Field label="Paiement" value={PAYMENT_LABELS[sale.paymentMethod]} />
              <Field
                label="Facturation"
                value={
                  sale.invoiceNumber ? (
                    <Link href="/factures" className="text-primary hover:underline">
                      {sale.invoiceNumber}
                    </Link>
                  ) : (
                    "Non facturée"
                  )
                }
              />
            </CardContent>
          </Card>

          {sale.returns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Retours enregistrés</CardTitle>
              </CardHeader>
              <CardContent className="space-y-sp-md">
                {sale.returns.map((entry) => (
                  <div key={entry.id} className="space-y-sp-xs border-b pb-sp-md last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-sp-sm">
                      <span className="text-xs text-muted-foreground">
                        {entry.createdAt.toLocaleString("fr-FR")}
                      </span>
                      <span className="text-sm font-medium text-foreground">
                        {formatMad(entry.totalRefund)}
                      </span>
                    </div>
                    {entry.isLotRecall && (
                      <Badge variant="destructive">
                        Rappel de lot
                        {entry.recallReference ? ` · ${entry.recallReference}` : ""}
                      </Badge>
                    )}
                    <ul className="space-y-sp-xs text-sm">
                      {entry.lines.map((line, index) => (
                        <li key={index} className="flex justify-between gap-sp-sm">
                          <span className="truncate">
                            {line.quantity} × {line.productName}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {line.restocked ? "Remis en stock" : "Détruit"}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {entry.note && (
                      <p className="text-xs text-muted-foreground italic">{entry.note}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <SaleReturnDialog sale={sale} open={returnOpen} onOpenChange={setReturnOpen} />
    </div>
  );
}
