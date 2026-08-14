"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import {
  createSupplierCredit,
  type CreditableProduct,
} from "@/lib/server/supplier-credits";
import {
  affectsStock,
  computeCreditTotal,
  SUPPLIER_CREDIT_MOTIFS,
  SUPPLIER_CREDIT_MOTIF_LABELS,
  type SupplierCreditMotifValue,
} from "@/lib/suppliers/credits";
import { formatOrderNumber } from "@/lib/orders/numbering";
import { formatMad } from "@/lib/invoices/totals";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";

export function CreateCreditForm({
  orderId,
  orderNumero,
  supplierId,
  supplierName,
  products,
}: {
  orderId: string;
  orderNumero: number;
  supplierId: string;
  supplierName: string;
  products: CreditableProduct[];
}) {
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [motif, setMotif] = useState<SupplierCreditMotifValue>("produit_endommage");
  const [lieRappelLot, setLieRappelLot] = useState(false);
  const [note, setNote] = useState("");

  const lines = useMemo(
    () =>
      products
        .map((product) => ({
          productId: product.productId,
          quantite: quantities[product.productId] ?? 0,
          unitPrice: product.unitPrice,
        }))
        .filter((line) => line.quantite > 0),
    [products, quantities],
  );

  // Amount follows the price actually paid to this supplier on this order,
  // which is what a claim is worth — not the shelf price.
  const total = computeCreditTotal(lines);
  const movesStock = affectsStock(motif);

  const mutation = useMutation({
    mutationFn: () =>
      createSupplierCredit({
        supplierId,
        orderId,
        motif,
        lieRappelLot,
        note: note || undefined,
        lines,
      }),
    onSuccess: (credit) => {
      router.push(`/commandes/avoirs/${credit.id}`);
      router.refresh();
    },
  });

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Signaler un problème"
        subtitle={`Commande ${formatOrderNumber(orderNumero)} · ${supplierName}`}
        icon={<RotateCcw />}
        backHref={`/commandes/${orderId}`}
        backLabel="la commande"
      />

      <Card>
        <CardHeader>
          <CardTitle>Produits concernés</CardTitle>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun produit reçu pour cette commande — un avoir ne peut porter que sur de la
              marchandise déjà livrée.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produit</TableHead>
                  <TableHead className="text-right">Reçu</TableHead>
                  <TableHead className="text-right">Prix d&apos;achat</TableHead>
                  <TableHead className="text-right">Quantité concernée</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => {
                  const quantite = quantities[product.productId] ?? 0;
                  return (
                    <TableRow key={product.productId}>
                      <TableCell className="font-medium text-foreground">
                        {product.productName}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {product.quantiteLivree}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {product.unitPrice.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          max={product.quantiteLivree}
                          aria-label={`Quantité concernée pour ${product.productName}`}
                          value={quantite === 0 ? "" : quantite}
                          placeholder="0"
                          onChange={(event) =>
                            setQuantities((previous) => ({
                              ...previous,
                              [product.productId]: Math.max(
                                0,
                                // Capped at what was delivered: you can't
                                // claim back more than you received.
                                Math.min(Number(event.target.value) || 0, product.quantiteLivree),
                              ),
                            }))
                          }
                          className="ml-auto w-24 text-right"
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {quantite > 0 ? (product.unitPrice * quantite).toFixed(2) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Motif</CardTitle>
        </CardHeader>
        <CardContent className="space-y-sp-md">
          <div className="space-y-sp-sm">
            <Label htmlFor="credit-motif">Raison de la réclamation</Label>
            <Select
              value={motif}
              onValueChange={(value) => setMotif(value as SupplierCreditMotifValue)}
            >
              <SelectTrigger id="credit-motif" className="w-full max-w-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPLIER_CREDIT_MOTIFS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {SUPPLIER_CREDIT_MOTIF_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!movesStock && (
              <p className="text-xs text-muted-foreground">
                Réclamation sur le montant : aucun produit ne quitte le stock.
              </p>
            )}
          </div>

          <div className="space-y-sp-sm rounded-lg bg-muted/50 p-sp-md">
            <div className="flex items-center gap-sp-sm">
              <Checkbox
                id="lot-recall"
                checked={lieRappelLot}
                onCheckedChange={(checked) => setLieRappelLot(checked === true)}
              />
              <Label htmlFor="lot-recall" className="font-medium">
                Lié à un rappel de lot officiel
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Conservé sur l&apos;avoir et dans le mouvement de stock, pour la traçabilité
              réglementaire.
            </p>
          </div>

          <div className="space-y-sp-sm">
            <Label htmlFor="credit-note">Note (facultatif)</Label>
            <Textarea
              id="credit-note"
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
        </CardContent>
      </Card>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-sp-md rounded-xl bg-card p-sp-md shadow-card">
        <div>
          <p className="text-sm text-muted-foreground">Montant réclamé</p>
          <p className="font-heading text-3xl font-extrabold tabular-nums text-foreground">
            {formatMad(total)}
          </p>
          {movesStock && lines.length > 0 && (
            // Said plainly before the click: this is the step that moves stock.
            <p className="text-xs text-muted-foreground">
              Le stock des produits sélectionnés sera décrémenté immédiatement.
            </p>
          )}
        </div>
        <Button
          onClick={() => mutation.mutate()}
          disabled={lines.length === 0 || mutation.isPending}
        >
          {mutation.isPending ? "Enregistrement..." : "Créer l'avoir"}
        </Button>
      </div>
    </div>
  );
}
