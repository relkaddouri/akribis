"use client";

import { useState } from "react";
import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Entry point for "suggest this product", nothing more.
 *
 * The suggestion flow itself — a form, a queue, an Akribis review screen,
 * a notification back to the pharmacy — is a phase of its own. What is
 * built here is the door and an honest sign on it: a button that promises
 * to send a suggestion and silently does nothing would be worse than no
 * button, because the pharmacist would stop looking for another way in.
 */
export function SuggestProductDialog({ terme }: { terme: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Lightbulb /> Suggérer ce produit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suggérer « {terme} » au catalogue</DialogTitle>
          <DialogDescription>
            L&apos;envoi de suggestions à l&apos;équipe Akribis arrive prochainement. En attendant,
            ajoutez le produit à votre stock par la saisie manuelle : il restera propre à votre
            officine, et basculera sur la fiche nationale dès qu&apos;elle existera.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
