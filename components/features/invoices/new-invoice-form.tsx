"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import {
  createInvoiceFromSales,
  listInvoiceableSales,
  type InvoiceableSale,
} from "@/lib/server/invoices";
import { formatMad } from "@/lib/invoices/totals";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";

/** Sales are grouped per client so a valid multi-sale selection is obvious. */
function clientKey(sale: InvoiceableSale) {
  return sale.clientId ?? "__walk_in__";
}

export function NewInvoiceForm() {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const salesQuery = useQuery({
    queryKey: ["invoiceable-sales"],
    queryFn: () => listInvoiceableSales(),
  });
  // Memoised so the `?? []` fallback isn't a fresh array each render,
  // which would defeat the useMemo hooks below.
  const sales = useMemo(() => salesQuery.data ?? [], [salesQuery.data]);

  const mutation = useMutation({
    mutationFn: () => createInvoiceFromSales([...selected]),
    onSuccess: (invoice) => router.push(`/factures/${invoice.id}`),
  });

  // Only sales sharing the selection's client stay selectable: one
  // invoice bills one payer, so mixing them is blocked at the source
  // rather than surfaced as an error after submission.
  const lockedClient = useMemo(() => {
    const first = sales.find((sale) => selected.has(sale.id));
    return first ? clientKey(first) : null;
  }, [sales, selected]);

  const total = useMemo(
    () => sales.filter((sale) => selected.has(sale.id)).reduce((sum, sale) => sum + sale.totalAmount, 0),
    [sales, selected],
  );

  function toggle(saleId: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(saleId)) next.delete(saleId);
      else next.add(saleId);
      return next;
    });
  }

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Nouvelle facture"
        icon={<FileText />}
        actions={
          <Button variant="outline" asChild>
            <Link href="/factures">Retour</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Ventes à facturer</CardTitle>
          <CardDescription>
            Sélectionnez une vente, ou plusieurs ventes d&apos;un même client pour les regrouper sur
            une seule facture. Les ventes déjà facturées n&apos;apparaissent pas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-sp-md">
          {mutation.isError && (
            <Alert variant="destructive">
              <AlertDescription>{(mutation.error as Error).message}</AlertDescription>
            </Alert>
          )}

          {salesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement des ventes...</p>
          ) : sales.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune vente en attente de facturation.
            </p>
          ) : (
            <ul className="divide-y">
              {sales.map((sale) => {
                const disabled = lockedClient !== null && clientKey(sale) !== lockedClient;
                return (
                  <li key={sale.id} className="flex items-center gap-sp-md py-sp-sm">
                    <Checkbox
                      checked={selected.has(sale.id)}
                      onCheckedChange={() => toggle(sale.id)}
                      disabled={disabled}
                      aria-label={`Sélectionner la vente du ${sale.createdAt.toLocaleString("fr-FR")}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {sale.clientName ?? "Client de passage"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {sale.createdAt.toLocaleString("fr-FR")} · {sale.itemCount} ligne
                        {sale.itemCount > 1 ? "s" : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm">{formatMad(sale.totalAmount)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-sp-md rounded-xl bg-card p-sp-md shadow-soft">
        <div className="text-sm">
          <span className="text-muted-foreground">
            {selected.size} vente{selected.size > 1 ? "s" : ""} sélectionnée
            {selected.size > 1 ? "s" : ""}
          </span>
          {selected.size > 0 && (
            <span className="ml-sp-sm font-medium text-foreground">{formatMad(total)} HT</span>
          )}
        </div>
        <Button
          onClick={() => mutation.mutate()}
          disabled={selected.size === 0 || mutation.isPending}
        >
          {mutation.isPending ? "Génération..." : "Générer la facture"}
        </Button>
      </div>
    </div>
  );
}
