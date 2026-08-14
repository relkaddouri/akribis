"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { BellPlus } from "lucide-react";
import { createReminder } from "@/lib/server/reminders";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NO_PRODUCT = "__none__";

/**
 * Schedules a manual call-back. Nothing is sent anywhere — the reminder
 * lands on the /rappels worklist for the pharmacist to phone through.
 */
export function ClientReminderDialog({
  clientId,
  products = [],
}: {
  clientId: string;
  /** Optional products to attach the reminder to, e.g. the lines of a sale. */
  products?: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [productId, setProductId] = useState(NO_PRODUCT);

  const mutation = useMutation({
    mutationFn: () =>
      createReminder({
        clientId,
        productId: productId === NO_PRODUCT ? null : productId,
        dateRappel: date,
        note,
      }),
    onSuccess: () => {
      setOpen(false);
      setDate("");
      setNote("");
      setProductId(NO_PRODUCT);
      router.refresh();
    },
  });

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <BellPlus className="size-4" />
        Programmer un rappel
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Programmer un rappel</DialogTitle>
            <DialogDescription>
              Le rappel apparaîtra dans la liste des rappels à la date choisie. Aucun message
              n&apos;est envoyé automatiquement — vous contactez le client vous-même.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-sp-md">
            <div className="space-y-sp-sm">
              <Label htmlFor="reminder-date">Date du rappel</Label>
              <Input
                id="reminder-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>

            {products.length > 0 && (
              <div className="space-y-sp-sm">
                <Label htmlFor="reminder-product">Produit concerné (facultatif)</Label>
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger id="reminder-product" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PRODUCT}>Aucun produit précis</SelectItem>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-sp-sm">
              <Label htmlFor="reminder-note">Note</Label>
              <Textarea
                id="reminder-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Ex : Rappeler pour le renouvellement de traitement"
                rows={3}
              />
            </div>

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
              disabled={mutation.isPending || !date || !note.trim()}
            >
              {mutation.isPending ? "Enregistrement..." : "Programmer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
