"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, PackageSearch, Trash2, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listSuppliers } from "@/lib/server/suppliers";
import { createOrder } from "@/lib/server/orders";
import { listUsableSupplierCredits } from "@/lib/server/supplier-credits";
import { allocateCredits } from "@/lib/suppliers/credit-allocation";
import { formatCreditNumber } from "@/lib/orders/numbering";
import { formatMad } from "@/lib/invoices/totals";
import { round2 } from "@/lib/pos/cart";
import { isLowStock } from "@/lib/stock/alerts";
import { listProducts, type ProductRecord } from "@/lib/offline/products";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { ProductSearch } from "@/components/features/pos/product-search";

type OrderLine = {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  /** Stock at the time the line was added — shown as context, never a limit. */
  quantityInStock: number;
};

/** How many restock suggestions to offer before anything is typed. */
const MAX_SUGGESTIONS = 8;


export function NewOrderForm({ initialSupplierId = "" }: { initialSupplierId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [supplierId, setSupplierId] = useState<string>(initialSupplierId);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [selectedCreditIds, setSelectedCreditIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const suppliersQuery = useQuery({ queryKey: ["suppliers"], queryFn: () => listSuppliers() });
  const suppliers = suppliersQuery.data ?? [];

  /**
   * Products at or below their own alert threshold, offered as soon as the
   * search box is focused. On a purchase screen these are exactly the ones
   * worth ordering, so the buyer starts from a proposal instead of a blank
   * field they have to guess at.
   */
  // On ne recommande pas un produit que l'officine a retiré de sa vente.
  const productsQuery = useQuery({
    queryKey: ["products", { actifsSeulement: true }],
    queryFn: () => listProducts({ actifsSeulement: true }),
  });
  const suggestions = useMemo(() => {
    const chosen = new Set(lines.map((line) => line.productId));
    return (productsQuery.data ?? [])
      .filter((product) => isLowStock(product) && !chosen.has(product.id))
      .sort((a, b) => a.quantityInStock - b.quantityInStock)
      .slice(0, MAX_SUGGESTIONS);
  }, [productsQuery.data, lines]);

  const creditsQuery = useQuery({
    queryKey: ["supplier-usable-credits", supplierId],
    queryFn: () => listUsableSupplierCredits(supplierId),
    enabled: supplierId !== "",
  });
  const credits = useMemo(() => creditsQuery.data ?? [], [creditsQuery.data]);

  const subtotal = useMemo(
    () => round2(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)),
    [lines],
  );

  // The same allocation function the server runs inside the order's
  // transaction, so the total shown here is the total that gets recorded.
  const allocation = useMemo(() => {
    const selected = credits.filter((credit) => selectedCreditIds.includes(credit.id));
    return allocateCredits(subtotal, selected);
  }, [credits, selectedCreditIds, subtotal]);

  const mutation = useMutation({
    mutationFn: () =>
      createOrder({
        supplierId,
        items: lines.map((line) => ({
          productId: line.productId,
          quantity: String(line.quantity),
          unitPrice: String(line.unitPrice),
        })),
        creditIds: selectedCreditIds,
      }),
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-usable-credits"] });
      router.push(`/commandes/${order.id}`);
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleSupplierChange(value: string) {
    setSupplierId(value);
    // Credits belong to one supplier: keeping a previous selection would
    // silently apply another supplier's money to this order.
    setSelectedCreditIds([]);
  }

  function handleAddProduct(product: ProductRecord) {
    setLines((prev) => {
      const existing = prev.find((line) => line.productId === product.id);
      // Selecting the same product again bumps its quantity rather than
      // doing nothing, which reads as the click having failed.
      if (existing) {
        return prev.map((line) =>
          line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          productName: product.name,
          quantity: 1,
          unitPrice: product.price,
          quantityInStock: product.quantityInStock,
        },
      ];
    });
  }

  function updateLine(productId: string, changes: Partial<OrderLine>) {
    setLines((prev) =>
      prev.map((line) => (line.productId === productId ? { ...line, ...changes } : line)),
    );
  }

  function removeLine(productId: string) {
    setLines((prev) => prev.filter((line) => line.productId !== productId));
  }

  function toggleCredit(creditId: string) {
    setSelectedCreditIds((prev) =>
      prev.includes(creditId) ? prev.filter((id) => id !== creditId) : [...prev, creditId],
    );
  }

  function handleSubmit() {
    setError(null);
    if (!supplierId) {
      setError("Choisissez un fournisseur.");
      return;
    }
    if (lines.length === 0) {
      setError("Ajoutez au moins un produit.");
      return;
    }
    mutation.mutate();
  }

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Nouvelle commande"
        icon={<ClipboardList />}
        backHref="/commandes"
        backLabel="Commandes"
      />

      {/* Two zones: composing the order on the left, what it costs on the
          right. The right column stays in view while the left one grows. */}
      <div className="grid items-start gap-sp-lg lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-sp-lg">
          <section className="space-y-sp-sm rounded-xl bg-card p-sp-lg shadow-soft">
            <Label htmlFor="order-supplier">Fournisseur</Label>
            {suppliers.length === 0 && !suppliersQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">
                Aucun fournisseur.{" "}
                <Link href="/commandes/fournisseurs" className="underline">
                  Ajoutez-en un d&apos;abord
                </Link>
                .
              </p>
            ) : (
              <Select value={supplierId} onValueChange={handleSupplierChange}>
                <SelectTrigger id="order-supplier" className="w-full max-w-sm">
                  <SelectValue placeholder="Choisir un fournisseur" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </section>

          <section className="space-y-sp-md rounded-xl bg-card p-sp-lg shadow-soft">
            <div className="space-y-sp-xs">
              <Label>Produits à commander</Label>
              <p className="text-sm text-muted-foreground">
                Un stock bas ou nul n&apos;empêche jamais la sélection : c&apos;est justement ce
                qu&apos;une commande sert à corriger.
              </p>
            </div>

            <ProductSearch
              context="purchase"
              onSelect={handleAddProduct}
              placeholder="Rechercher un produit à commander (nom, code-barres, DCI)..."
              suggestions={suggestions}
              suggestionsLabel="Suggestions — stock à réapprovisionner"
            />

            {lines.length === 0 ? (
              <div className="flex flex-col items-center gap-sp-sm rounded-lg border border-dashed border-border py-sp-xl text-center">
                <PackageSearch
                  className="size-8 text-muted-foreground"
                  strokeWidth={1.5}
                  aria-hidden
                />
                <p className="text-sm text-muted-foreground">
                  Aucun produit dans la commande.
                  {suggestions.length > 0
                    ? " Cliquez dans la recherche pour voir les produits à réapprovisionner."
                    : ""}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {lines.map((line) => (
                  <li
                    key={line.productId}
                    className="flex flex-wrap items-end justify-between gap-sp-md py-sp-md"
                  >
                    <div className="min-w-0 flex-1 space-y-sp-xs">
                      <p className="truncate font-medium text-foreground">{line.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        Stock actuel : {line.quantityInStock}
                      </p>
                    </div>

                    <div className="space-y-sp-xs">
                      <Label
                        htmlFor={`qty-${line.productId}`}
                        className="text-xs text-muted-foreground"
                      >
                        Quantité
                      </Label>
                      <Input
                        id={`qty-${line.productId}`}
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(event) =>
                          updateLine(line.productId, {
                            quantity: Math.max(1, Number(event.target.value) || 1),
                          })
                        }
                        className="w-24"
                      />
                    </div>

                    <div className="space-y-sp-xs">
                      <Label
                        htmlFor={`price-${line.productId}`}
                        className="text-xs text-muted-foreground"
                      >
                        Prix d&apos;achat
                      </Label>
                      <Input
                        id={`price-${line.productId}`}
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(event) =>
                          updateLine(line.productId, {
                            unitPrice: Math.max(0, Number(event.target.value) || 0),
                          })
                        }
                        className="w-28"
                      />
                    </div>

                    <div className="space-y-sp-xs text-right">
                      <p className="text-xs text-muted-foreground">Total ligne</p>
                      <p className="font-medium tabular-nums text-foreground">
                        {formatMad(round2(line.quantity * line.unitPrice))}
                      </p>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeLine(line.productId)}
                      aria-label={`Retirer ${line.productName}`}
                    >
                      <Trash2 className="size-4" strokeWidth={1.75} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Sticky so the running total and the submit button stay reachable
            however long the product list gets. */}
        <aside className="space-y-sp-md rounded-xl bg-card p-sp-lg shadow-soft lg:sticky lg:top-sp-lg">
          <h2 className="font-semibold text-foreground">Récapitulatif</h2>

          <dl className="space-y-sp-sm text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">
                Sous-total ({lines.length} produit{lines.length > 1 ? "s" : ""})
              </dt>
              <dd className="tabular-nums text-foreground">{formatMad(subtotal)}</dd>
            </div>

            {allocation.deducted > 0 && (
              <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-300">
                <dt>Avoirs appliqués</dt>
                <dd className="tabular-nums">− {formatMad(allocation.deducted)}</dd>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-border pt-sp-sm text-base font-semibold">
              <dt>Total à payer</dt>
              <dd className="tabular-nums">{formatMad(allocation.finalTotal)}</dd>
            </div>
          </dl>

          {supplierId && credits.length > 0 && (
            <div className="space-y-sp-sm border-t border-border pt-sp-md">
              <div className="flex items-center gap-sp-xs text-sm font-medium text-foreground">
                <Wallet className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                Avoirs disponibles
              </div>
              {/* Opt-in, never automatic: keeping a credit for a larger
                  order later is a legitimate choice, so nothing is spent
                  unless the pharmacist ticks it. */}
              <ul className="space-y-sp-xs">
                {credits.map((credit) => {
                  const applied = allocation.consumed.find((entry) => entry.id === credit.id);
                  return (
                    <li key={credit.id}>
                      <label className="flex cursor-pointer items-start gap-sp-sm rounded-lg px-sp-xs py-sp-xs text-sm transition-colors hover:bg-accent">
                        <Checkbox
                          checked={selectedCreditIds.includes(credit.id)}
                          onCheckedChange={() => toggleCredit(credit.id)}
                          className="mt-sp-xs"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-foreground">
                            Avoir {formatCreditNumber(credit.numero)}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {formatMad(credit.montantRestant)} disponible
                            {applied && applied.amount < credit.montantRestant
                              ? ` · ${formatMad(applied.amount)} utilisé sur cette commande`
                              : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {supplierId && credits.length === 0 && !creditsQuery.isLoading && (
            <p className="border-t border-border pt-sp-md text-sm text-muted-foreground">
              Aucun avoir disponible chez ce fournisseur.
            </p>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            type="button"
            onClick={handleSubmit}
            // Always visible so the next step is never in doubt; disabled
            // only for the two things that genuinely block a valid order.
            disabled={mutation.isPending || lines.length === 0 || !supplierId}
            className="w-full"
          >
            {mutation.isPending ? "Création..." : "Créer la commande"}
          </Button>

          {lines.length === 0 && (
            <p className="text-center text-xs text-muted-foreground">
              Ajoutez au moins un produit pour créer la commande.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
