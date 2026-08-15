"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { VarianceReport } from "@/lib/inventory/variance";
import { formatMad } from "@/lib/invoices/totals";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * The variance report, and the one button that changes stock.
 *
 * Everything here is computed on the device from the counts already held
 * locally, so it reads the same with or without a connection. Applying is
 * behind a confirmation that names what will change: this is the moment
 * recorded stock is overwritten by what someone saw on a shelf.
 */
export function InventoryVarianceReport({
  report,
  readOnly,
  onApply,
}: {
  report: VarianceReport;
  readOnly: boolean;
  onApply: () => Promise<void>;
}) {
  const [applying, setApplying] = useState(false);
  const partial = report.countedCount < report.totalCount;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rapport d&apos;écarts</CardTitle>
        <CardDescription>
          {report.lines.length === 0
            ? "Aucun écart : tous les produits comptés correspondent au stock enregistré."
            : `${report.lines.length} produit${report.lines.length > 1 ? "s" : ""} en écart · ${report.totalManquant} manquant${report.totalManquant > 1 ? "s" : ""}, ${report.totalSurplus} en surplus`}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-sp-md">
        {partial && (
          <p className="flex gap-sp-sm rounded-lg bg-orange-100 px-sp-md py-sp-sm text-sm text-orange-800 dark:bg-orange-950 dark:text-orange-200">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            <span>
              {report.totalCount - report.countedCount} produit
              {report.totalCount - report.countedCount > 1 ? "s" : ""} n&apos;ont pas encore été
              comptés. Ils ne figurent pas dans ce rapport et ne seront pas ajustés — un rayon non
              compté n&apos;est pas un rayon vide.
            </span>
          </p>
        )}

        {report.lines.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produit</TableHead>
                    <TableHead className="text-right">Théorique</TableHead>
                    <TableHead className="text-right">Compté</TableHead>
                    <TableHead className="text-right">Écart</TableHead>
                    <TableHead className="text-right">Valeur</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.lines.map((line) => (
                    <TableRow key={line.productId}>
                      <TableCell className="font-medium">{line.productName}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.quantiteTheorique}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.quantiteComptee}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-medium tabular-nums",
                          line.ecart < 0
                            ? "text-destructive"
                            : "text-emerald-700 dark:text-emerald-300",
                        )}
                      >
                        {line.ecart > 0 ? "+" : ""}
                        {line.ecart}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          line.valeurEcart < 0
                            ? "text-destructive"
                            : "text-emerald-700 dark:text-emerald-300",
                        )}
                      >
                        {line.valeurEcart > 0 ? "+" : ""}
                        {formatMad(line.valeurEcart)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-sp-sm border-t border-border pt-sp-md">
              <span className="font-semibold text-foreground">Impact total sur la valeur</span>
              <span
                className={cn(
                  "text-lg font-bold tabular-nums",
                  report.totalValeur < 0
                    ? "text-destructive"
                    : "text-emerald-700 dark:text-emerald-300",
                )}
              >
                {report.totalValeur > 0 ? "+" : ""}
                {formatMad(report.totalValeur)}
              </span>
            </div>
          </>
        )}

        {!readOnly && report.lines.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={applying}>
                {applying ? "Application..." : "Appliquer les ajustements"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Ajuster {report.lines.length} produit{report.lines.length > 1 ? "s" : ""} ?
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-sp-sm">
                    <p>
                      Le stock enregistré de ces produits sera remplacé par la quantité comptée, et
                      un mouvement de stock sera enregistré pour chacun. L&apos;inventaire passera
                      en « Terminé » et ne pourra plus être modifié.
                    </p>
                    {partial && (
                      <p>
                        Les {report.totalCount - report.countedCount} produits non comptés ne sont
                        pas concernés.
                      </p>
                    )}
                    <p>
                      L&apos;ajustement s&apos;applique immédiatement sur cet appareil, même sans
                      connexion, et sera envoyé au serveur au retour du réseau.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    setApplying(true);
                    try {
                      await onApply();
                    } finally {
                      setApplying(false);
                    }
                  }}
                >
                  Appliquer
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {readOnly && (
          <p className="text-sm text-muted-foreground">
            Inventaire terminé — rapport en lecture seule.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
