"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Award, Wallet } from "lucide-react";
import { registerClientPayment } from "@/lib/server/client-account";
import { amountOwed, getBalanceState } from "@/lib/clients/account";
import { margeDisponible } from "@/lib/clients/plafond";
import { formatMad } from "@/lib/invoices/totals";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The account headline. Colour carries the meaning at a glance: red when
 * the client owes money, green when the pharmacy does, neutral when
 * settled — the pharmacist shouldn't have to read a minus sign to know
 * which way round it is.
 */
export function ClientBalanceCard({
  clientId,
  solde,
  points,
  plafondCredit,
}: {
  clientId: string;
  solde: number;
  points: number;
  /** `null` = aucun plafond fixé sur la fiche. */
  plafondCredit: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const state = getBalanceState(solde);
  // Collée au solde, et pas rangée dans une section « Crédit » à part : la
  // question que le pharmacien se pose est « puis-je encore lui faire
  // crédit », et elle se répond en lisant les deux nombres ensemble.
  const marge = margeDisponible(solde, plafondCredit);

  const mutation = useMutation({
    mutationFn: () => registerClientPayment({ clientId, amount: Number(amount) }),
    onSuccess: () => {
      setOpen(false);
      setAmount("");
      router.refresh();
    },
  });

  return (
    <div className="grid gap-sp-md sm:grid-cols-[2fr_1fr]">
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-sp-md rounded-xl p-sp-lg",
          state === "debt" && "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
          state === "credit" &&
            "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
          state === "settled" && "bg-card text-foreground shadow-card",
        )}
      >
        <div>
          <p className="flex items-center gap-sp-xs text-sm font-medium">
            <Wallet className="size-4" strokeWidth={1.75} aria-hidden />
            {state === "debt" ? "Doit à la pharmacie" : state === "credit" ? "Crédit disponible" : "Solde"}
          </p>
          <p className="font-heading text-4xl font-extrabold tabular-nums">
            {formatMad(state === "debt" ? amountOwed(solde) : Math.abs(solde))}
          </p>
          {plafondCredit === null ? (
            <p className="mt-sp-xs text-sm opacity-80">Aucun plafond de crédit fixé</p>
          ) : (
            <p className="mt-sp-xs text-sm opacity-80">
              Plafond {formatMad(plafondCredit)} ·{" "}
              <span className="font-medium tabular-nums">
                {marge === 0 ? "plafond atteint" : `${formatMad(marge!)} encore disponibles`}
              </span>
            </p>
          )}
        </div>
        <Button variant={state === "settled" ? "default" : "outline"} onClick={() => setOpen(true)}>
          Enregistrer un paiement
        </Button>
      </div>

      <div className="flex flex-col justify-center rounded-xl bg-card p-sp-lg shadow-card">
        <p className="flex items-center gap-sp-xs text-sm font-medium text-muted-foreground">
          <Award className="size-4" strokeWidth={1.75} aria-hidden />
          Points de fidélité
        </p>
        <p className="font-heading text-4xl font-extrabold tabular-nums text-foreground">{points}</p>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enregistrer un paiement</DialogTitle>
            <DialogDescription>
              {state === "debt"
                ? `Le client doit ${formatMad(amountOwed(solde))}. Saisissez le montant reçu.`
                : "Saisissez un montant positif pour encaisser, négatif pour rembourser le client."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-sp-sm">
            <Label htmlFor="payment-amount">Montant reçu (MAD)</Label>
            <Input
              id="payment-amount"
              type="number"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="h-12 text-right font-heading text-xl font-bold tabular-nums"
            />
            {state === "debt" && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setAmount(String(amountOwed(solde)))}
              >
                Solder la totalité ({formatMad(amountOwed(solde))})
              </Button>
            )}
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
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || Number(amount) === 0 || amount === ""}
            >
              {mutation.isPending ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
