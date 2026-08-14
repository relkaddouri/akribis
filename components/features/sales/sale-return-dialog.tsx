"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { createSaleReturn } from "@/lib/server/sales-returns";
import { remainingReturnable, validateReturn } from "@/lib/sales/returns";
import { formatMad } from "@/lib/invoices/totals";
import type { SaleDetail } from "@/lib/server/sales-returns";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type LineState = { quantity: number; restock: boolean };

export function SaleReturnDialog({
  sale,
  open,
  onOpenChange,
}: {
  sale: SaleDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [isLotRecall, setIsLotRecall] = useState(false);
  const [recallReference, setRecallReference] = useState("");
  const [note, setNote] = useState("");

  const returnable = useMemo(
    () => sale.lines.filter((line) => remainingReturnable(line) > 0),
    [sale.lines],
  );

  const [lines, setLines] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(sale.lines.map((line) => [line.saleItemId, { quantity: 0, restock: true }])),
  );

  /**
   * Flipping the lot-recall switch retargets the default for every line:
   * recalled goods must not go back on the shelf, while an ordinary
   * client return usually should. Each line stays individually
   * overridable afterwards — the default is a starting point, not a lock.
   */
  function handleLotRecallChange(next: boolean) {
    setIsLotRecall(next);
    setLines((previous) =>
      Object.fromEntries(
        Object.entries(previous).map(([id, state]) => [id, { ...state, restock: !next }]),
      ),
    );
  }

  const preview = validateReturn(sale.lines,
    Object.entries(lines).map(([saleItemId, state]) => ({ saleItemId, ...state })),
  );
  const totalRefund = preview.ok ? preview.totalRefund : 0;

  const mutation = useMutation({
    mutationFn: () =>
      createSaleReturn(sale.id, {
        lines: Object.entries(lines).map(([saleItemId, state]) => ({ saleItemId, ...state })),
        isLotRecall,
        recallReference: recallReference || undefined,
        note: note || undefined,
      }),
    onSuccess: () => {
      onOpenChange(false);
      router.refresh();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Effectuer un retour</DialogTitle>
          <DialogDescription>
            Vente {sale.reference} — indiquez les quantités rendues, produit par produit.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-sp-md">
          {sale.invoiced && (
            <Alert>
              <AlertDescription>
                Cette vente est rattachée à la facture {sale.invoiceNumber}. Le retour ne modifie
                pas la facture déjà émise — pensez à l&apos;annuler et à la rééditer si nécessaire.
              </AlertDescription>
            </Alert>
          )}

          {returnable.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Tous les produits de cette vente ont déjà été retournés.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produit</TableHead>
                  <TableHead className="text-right">Retournable</TableHead>
                  <TableHead className="text-right">À retourner</TableHead>
                  <TableHead className="text-right">Détruire</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {returnable.map((line) => {
                  const remaining = remainingReturnable(line);
                  const state = lines[line.saleItemId] ?? { quantity: 0, restock: true };
                  return (
                    <TableRow key={line.saleItemId}>
                      <TableCell className="font-medium text-foreground">
                        {line.productName}
                        <span className="block text-xs font-normal text-muted-foreground">
                          {formatMad(line.unitPrice)} / unité
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{remaining}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          max={remaining}
                          aria-label={`Quantité à retourner pour ${line.productName}`}
                          value={state.quantity}
                          onChange={(event) =>
                            setLines((previous) => ({
                              ...previous,
                              [line.saleItemId]: {
                                ...state,
                                quantity: Math.max(
                                  0,
                                  Math.min(Number(event.target.value) || 0, remaining),
                                ),
                              },
                            }))
                          }
                          className="ml-auto w-20 text-right"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Checkbox
                          checked={!state.restock}
                          aria-label={`Détruire au lieu de remettre en stock : ${line.productName}`}
                          onCheckedChange={(checked) =>
                            setLines((previous) => ({
                              ...previous,
                              [line.saleItemId]: { ...state, restock: checked !== true },
                            }))
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          <div className="space-y-sp-sm rounded-lg bg-muted/50 p-sp-md">
            <div className="flex items-center gap-sp-sm">
              <Checkbox
                id="lot-recall"
                checked={isLotRecall}
                onCheckedChange={(checked) => handleLotRecallChange(checked === true)}
              />
              <Label htmlFor="lot-recall" className="font-medium">
                Retour lié à un rappel de lot officiel
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Coche « Détruire » sur toutes les lignes par défaut et conserve la référence du
              rappel dans le mouvement de stock, pour la traçabilité réglementaire.
            </p>
            {isLotRecall && (
              <div className="space-y-sp-xs">
                <Label htmlFor="recall-reference">Référence du rappel</Label>
                <Input
                  id="recall-reference"
                  value={recallReference}
                  onChange={(event) => setRecallReference(event.target.value)}
                  placeholder="N° de circulaire, numéro de lot..."
                />
              </div>
            )}
          </div>

          <div className="space-y-sp-xs">
            <Label htmlFor="return-note">Note (facultatif)</Label>
            <Textarea
              id="return-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
            />
          </div>

          {mutation.isError && (
            <Alert variant="destructive">
              <AlertDescription>{(mutation.error as Error).message}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="items-center justify-between gap-sp-md sm:justify-between">
          <span className="text-sm">
            <span className="text-muted-foreground">Remboursement : </span>
            <span className="font-heading font-bold text-foreground">{formatMad(totalRefund)}</span>
          </span>
          <div className="flex gap-sp-sm">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={!preview.ok || mutation.isPending}
            >
              {mutation.isPending ? "Enregistrement..." : "Confirmer le retour"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
