"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listSuppliers } from "@/lib/server/suppliers";
import { createOrder } from "@/lib/server/orders";
import type { ProductRecord } from "@/lib/offline/products";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ProductSearch } from "@/components/features/pos/product-search";

type OrderLine = {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
};

export function NewOrderForm() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [supplierId, setSupplierId] = useState<string>("");
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const suppliersQuery = useQuery({ queryKey: ["suppliers"], queryFn: () => listSuppliers() });
  const suppliers = suppliersQuery.data ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      createOrder({
        supplierId,
        items: lines.map((line) => ({
          productId: line.productId,
          quantity: String(line.quantity),
          unitPrice: String(line.unitPrice),
        })),
      }),
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      router.push(`/dashboard/commandes/${order.id}`);
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleAddProduct(product: ProductRecord) {
    setLines((prev) => {
      if (prev.some((line) => line.productId === product.id)) return prev;
      return [
        ...prev,
        {
          productId: product.id,
          productName: product.name,
          quantity: 1,
          unitPrice: product.price,
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
        backHref="/dashboard/commandes"
        backLabel="Commandes"
      />

      <div className="max-w-2xl space-y-sp-lg">

      <div className="space-y-2">
        <Label>Fournisseur</Label>
        {suppliers.length === 0 && !suppliersQuery.isLoading ? (
          <p className="text-muted-foreground text-sm">
            Aucun fournisseur.{" "}
            <Link href="/dashboard/commandes/fournisseurs" className="underline">
              Ajoutez-en un d&apos;abord
            </Link>
            .
          </p>
        ) : (
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger className="w-full max-w-sm">
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
      </div>

      <div className="space-y-2">
        <Label>Produits</Label>
        <ProductSearch onSelect={handleAddProduct} />
      </div>

      {lines.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produit</TableHead>
              <TableHead>Quantité</TableHead>
              <TableHead>Prix d&apos;achat unitaire</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.productId}>
                <TableCell className="font-medium">{line.productName}</TableCell>
                <TableCell>
                  <Input
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
                </TableCell>
                <TableCell>
                  <Input
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
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeLine(line.productId)}
                  >
                    Retirer
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="button" onClick={handleSubmit} disabled={mutation.isPending}>
        {mutation.isPending ? "Création..." : "Créer la commande"}
      </Button>
      </div>
    </div>
  );
}
