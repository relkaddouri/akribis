/**
 * Pure logic for supplier credit notes. Framework- and data-layer-agnostic,
 * same split as lib/stock/alerts.ts.
 *
 * THE RULE THIS FILE EXISTS TO STATE: stock leaves when a credit is ISSUED
 * (`emis`), never when it is settled (`recu`). Issuing is the moment the
 * goods physically go back to the supplier; settlement only records how the
 * supplier compensated. Decrementing again on settlement would remove the
 * same units twice.
 */

import { round2 } from "@/lib/pos/cart";

export const SUPPLIER_CREDIT_STATUSES = ["emis", "recu"] as const;
export type SupplierCreditStatusValue = (typeof SUPPLIER_CREDIT_STATUSES)[number];

export const SUPPLIER_CREDIT_STATUS_LABELS: Record<SupplierCreditStatusValue, string> = {
  emis: "Émis",
  recu: "Reçu",
};

export const SUPPLIER_CREDIT_MOTIFS = [
  "produit_endommage",
  "produit_perime",
  "rappel_lot",
  "erreur_livraison",
  "erreur_prix",
  "remise",
  "autre",
] as const;
export type SupplierCreditMotifValue = (typeof SUPPLIER_CREDIT_MOTIFS)[number];

export const SUPPLIER_CREDIT_MOTIF_LABELS: Record<SupplierCreditMotifValue, string> = {
  produit_endommage: "Produit endommagé",
  produit_perime: "Produit périmé",
  rappel_lot: "Rappel de lot",
  erreur_livraison: "Erreur de livraison",
  erreur_prix: "Erreur de prix",
  remise: "Remise",
  autre: "Autre",
};

export const COMPENSATION_MODES = ["avoir_credit", "especes"] as const;
export type CompensationModeValue = (typeof COMPENSATION_MODES)[number];

export const COMPENSATION_MODE_LABELS: Record<CompensationModeValue, string> = {
  avoir_credit: "Avoir / crédit fournisseur",
  especes: "Espèces",
};

/**
 * Whether issuing this credit should take goods off the shelf.
 *
 * A price-only claim (`erreur_prix`, `remise`) is about money, not
 * merchandise: nothing physically leaves, so nothing is decremented. Every
 * other motive concerns goods going back to the supplier.
 */
export function affectsStock(motif: SupplierCreditMotifValue): boolean {
  return motif !== "erreur_prix" && motif !== "remise";
}

/**
 * Whether a status change is allowed. The document moves forward only:
 * emis → recu. Re-settling a settled credit is rejected rather than
 * silently re-applied, which is the guard that stops a second stock
 * decrement from ever being attempted.
 */
export function canTransition(
  from: SupplierCreditStatusValue,
  to: SupplierCreditStatusValue,
): boolean {
  return from === "emis" && to === "recu";
}

export type CreditLineInput = {
  productId: string;
  quantite: number;
  unitPrice: number;
};

/** Claim total, rounded per line so the printed lines add up to the total. */
export function computeCreditTotal(lines: CreditLineInput[]): number {
  return round2(
    lines.reduce((sum, line) => sum + round2(line.unitPrice * line.quantite), 0),
  );
}
