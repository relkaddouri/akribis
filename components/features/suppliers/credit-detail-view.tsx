"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { CircleCheck, RotateCcw } from "lucide-react";
import {
  settleSupplierCredit,
  type SupplierCreditDetail,
} from "@/lib/server/supplier-credits";
import {
  COMPENSATION_MODE_LABELS,
  SUPPLIER_CREDIT_MOTIF_LABELS,
  type CompensationModeValue,
} from "@/lib/suppliers/credits";
import { formatCreditNumber, formatOrderNumber } from "@/lib/orders/numbering";
import { formatMad } from "@/lib/invoices/totals";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { SupplierCreditBadge } from "@/components/features/suppliers/supplier-credit-badge";

/** One-line explanation under each option, so the choice needs no accounting background. */
const COMPENSATION_HINTS: Record<CompensationModeValue, string> = {
  avoir_credit:
    "Déduit automatiquement de votre prochaine commande chez ce fournisseur.",
  especes: "Montant reçu directement, sans lien avec une commande future.",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  );
}

export function CreditDetailView({ credit }: { credit: SupplierCreditDetail }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // "Avoir" is the common case, so it starts selected.
  const [mode, setMode] = useState<CompensationModeValue>("avoir_credit");

  const mutation = useMutation({
    mutationFn: () => settleSupplierCredit(credit.id, mode),
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });

  const pending = credit.statut === "emis";

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title={`Avoir ${formatCreditNumber(credit.numero)}`}
        subtitle={`${credit.supplierName} · ${formatMad(credit.montant)}`}
        icon={<RotateCcw />}
        backHref="/commandes/avoirs"
        backLabel="Avoirs"
        actions={
          <div className="flex items-center gap-sp-sm">
            <SupplierCreditBadge statut={credit.statut} />
            {pending && (
              <Button onClick={() => setOpen(true)}>
                <CircleCheck className="size-4" />
                Confirmer la réception
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-sp-md lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Produits retournés</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produit</TableHead>
                  <TableHead className="text-right">Quantité</TableHead>
                  <TableHead className="text-right">Prix unitaire</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credit.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-medium text-foreground">
                      {line.productName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{line.quantite}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.unitPrice.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.total.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="mt-sp-md flex justify-end border-t pt-sp-sm">
              <span className="font-heading text-base font-bold text-foreground">
                Total : {formatMad(credit.montant)}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Informations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-sp-md">
            <Field label="Motif" value={SUPPLIER_CREDIT_MOTIF_LABELS[credit.motif]} />
            <Field label="Fournisseur" value={credit.supplierName} />
            <Field
              label="Commande liée"
              value={
                credit.orderId && credit.orderNumero !== null ? (
                  <Link href={`/commandes/${credit.orderId}`} className="text-primary hover:underline">
                    {formatOrderNumber(credit.orderNumero)}
                  </Link>
                ) : (
                  "Aucune"
                )
              }
            />
            <Field label="Émis le" value={credit.dateEmission.toLocaleDateString("fr-FR")} />
            {credit.dateReception && (
              <Field
                label="Confirmé le"
                value={credit.dateReception.toLocaleDateString("fr-FR")}
              />
            )}
            {credit.modeCompensation && (
              <Field
                label="Compensation"
                value={COMPENSATION_MODE_LABELS[credit.modeCompensation]}
              />
            )}
            {credit.lieRappelLot && <Badge variant="destructive">Rappel de lot officiel</Badge>}
            {credit.note && <Field label="Note" value={credit.note} />}
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmer la réception</DialogTitle>
            <DialogDescription>
              Comment le fournisseur a-t-il compensé les {formatMad(credit.montant)} ?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-sp-sm">
            {(["avoir_credit", "especes"] as CompensationModeValue[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={cn(
                  "w-full rounded-lg border p-sp-md text-left transition-colors",
                  mode === value
                    ? "border-primary bg-accent"
                    : "border-border hover:bg-muted",
                )}
              >
                <p className="font-medium text-foreground">
                  {COMPENSATION_MODE_LABELS[value]}
                </p>
                <p className="mt-sp-xs text-xs text-muted-foreground">
                  {COMPENSATION_HINTS[value]}
                </p>
              </button>
            ))}

            {/* Stated explicitly: the goods already left when the claim was
                raised, so confirming changes paperwork only. */}
            <p className="text-xs text-muted-foreground">
              Le stock a déjà été décrémenté lors de la création de l&apos;avoir — cette
              confirmation ne le modifie pas.
            </p>

            {mutation.isError && (
              <Alert variant="destructive">
                <AlertDescription>{(mutation.error as Error).message}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? "Enregistrement..." : "Confirmer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
