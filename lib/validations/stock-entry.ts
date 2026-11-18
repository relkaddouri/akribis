import { z } from "zod";

/**
 * The short form shown once a catalogue fiche is picked: only what belongs
 * to the officine.
 *
 * Everything the catalogue already holds — DCI, posologie, monographie,
 * PPV, PPH, TVA, remboursement — is deliberately absent. Re-asking for it
 * is exactly what this phase removes, and a second place to type it is a
 * second place for it to be wrong.
 */

function optionalTrimmed() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : null));
}

function optionalPositive() {
  return z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : value),
    // `z.null()` en premier : une union est essayée de gauche à droite, et
    // `z.coerce.number()` accepte `null` en le convertissant en 0. Placé après,
    // il transformait tout champ vide en 0 — un PPV inconnu devenait un prix
    // réglementé de 0,00 DH, et un prix d'achat vide donnait 100 % de marge.
    z.union([z.null(), z.coerce.number().min(0, "Doit être ≥ 0")]),
  );
}

export const stockEntrySchema = z.object({
  catalogueProduitId: z.string().min(1, "Produit du catalogue requis"),
  /** Optional: a pharmacy may stock a product before choosing a wholesaler. */
  supplierId: optionalTrimmed(),
  quantiteInitiale: z.coerce
    .number()
    .int("Nombre entier requis")
    .min(0, "Doit être ≥ 0")
    .default(0),
  seuilAlerte: z.coerce.number().int("Nombre entier requis").min(0, "Doit être ≥ 0").default(0),
  referenceInterne: optionalTrimmed(),
  localisation: optionalTrimmed(),
  /**
   * The price actually invoiced to this pharmacy. Not the catalogue's PPH,
   * which is the regulated national reference — the margin is computed
   * from this one.
   */
  prixAchat: optionalPositive(),
});

export type StockEntryInput = z.input<typeof stockEntrySchema>;
export type StockEntryValues = z.output<typeof stockEntrySchema>;
