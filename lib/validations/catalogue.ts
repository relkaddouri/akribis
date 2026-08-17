import { z } from "zod";
import { MAX_CATALOGUE_PHOTOS } from "@/lib/catalogue/photo-rules";

/**
 * The national product catalogue — PRD section 5.1. Same conventions as
 * lib/validations/products.ts: form state is all strings, coerced only
 * here, so the schemas stay serializable across the RSC boundary.
 *
 * What is NOT here is as important as what is: no quantity, no purchase
 * price, no stock threshold. Those belong to a pharmacy's own
 * `pharmacy_stock` row, and an Akribis admin has no business setting them.
 */

function optionalTrimmed() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : null));
}

/** Coerces "" (an empty number input) to null instead of 0/NaN. */
function optionalPositive(message = "Doit être ≥ 0") {
  return z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : value),
    // `z.null()` en premier : une union est essayée de gauche à droite, et
    // `z.coerce.number()` accepte `null` en le convertissant en 0. Placé après,
    // il transformait tout champ vide en 0 — un PPV inconnu devenait un prix
    // réglementé de 0,00 DH, et un prix d'achat vide donnait 100 % de marge.
    z.union([z.null(), z.coerce.number().min(0, message)]),
  );
}

function optionalPercent() {
  return z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : value),
    // `z.null()` en premier : une union est essayée de gauche à droite, et
    // `z.coerce.number()` accepte `null` en le convertissant en 0. Placé après,
    // il transformait tout champ vide en 0 — un PPV inconnu devenait un prix
    // réglementé de 0,00 DH, et un prix d'achat vide donnait 100 % de marge.
    z.union([z.null(), z.coerce.number().min(0, "Entre 0 et 100").max(100, "Entre 0 et 100")]),
  );
}

export const PRODUIT_CATEGORIES = [
  { value: "PHARMACEUTIQUE", label: "Pharmaceutique" },
  { value: "PARAPHARMACEUTIQUE", label: "Parapharmaceutique" },
  { value: "DISPOSITIF_MEDICAL", label: "Dispositif médical" },
] as const;

export const TABLEAUX_SUBSTANCE = [
  { value: "AUCUN", label: "Aucun" },
  { value: "A", label: "Tableau A — substances toxiques" },
  { value: "B", label: "Tableau B — stupéfiants" },
  { value: "C", label: "Tableau C — substances dangereuses" },
] as const;

export type ProduitCategorieValue = (typeof PRODUIT_CATEGORIES)[number]["value"];
export type TableauSubstanceValue = (typeof TABLEAUX_SUBSTANCE)[number]["value"];

const CATEGORIE_VALUES = PRODUIT_CATEGORIES.map((c) => c.value) as [
  ProduitCategorieValue,
  ...ProduitCategorieValue[],
];
const TABLEAU_VALUES = TABLEAUX_SUBSTANCE.map((t) => t.value) as [
  TableauSubstanceValue,
  ...TableauSubstanceValue[],
];

/**
 * A CIP/CBO or EAN-13 is 13 digits. Enforced as a shape rather than a
 * checksum: the CNOPS 2014 referential is the source of truth for real
 * codes, and rejecting a code the referential itself contains would be
 * worse than accepting an odd one.
 */
const BARCODE_PATTERN = /^\d{8,14}$/;

const identificationShape = {
  nom: z.string().trim().min(1, "Nom requis"),
  codeBarres: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : null))
    .refine((value) => value === null || BARCODE_PATTERN.test(value), {
      message: "8 à 14 chiffres (CIP/CBO ou EAN-13)",
    }),
  dosage: optionalTrimmed(),
  /**
   * Ordered list of photo URLs. Position in the array *is* the order —
   * `ordre` is derived from it when writing, never carried around, so the
   * first item and "photo principale" cannot drift apart.
   */
  photos: z
    .array(z.string().trim().url("URL de photo invalide"))
    .max(MAX_CATALOGUE_PHOTOS, `${MAX_CATALOGUE_PHOTOS} photos au maximum`)
    .default([]),
  categorie: z
    .union([z.enum(CATEGORIE_VALUES), z.literal("")])
    .optional()
    .transform((value) => (value ? value : null)),
  classeTherapeutique: optionalTrimmed(),
  formeGalenique: z.string().trim().min(1, "Forme galénique requise"),
  dci: optionalTrimmed(),
  laboratoire: optionalTrimmed(),
  produitTableau: z.enum(TABLEAU_VALUES).default("AUCUN"),
  gamme: optionalTrimmed(),
  sousGamme: optionalTrimmed(),
  necessitePrescription: z.coerce.boolean().default(false),
  produitCommercialise: z.coerce.boolean().default(true),
  groupeProduits: optionalTrimmed(),
  actifCatalogue: z.coerce.boolean().default(true),
  refrigerationRequise: z.coerce.boolean().default(false),
  conditionnement: optionalTrimmed(),
  referenceLabo: optionalTrimmed(),
};

const pricingShape = {
  pph: optionalPositive(),
  ppv: optionalPositive(),
  prixBaseRemboursement: optionalPositive(),
  tvaAchat: optionalPercent(),
  tvaVente: optionalPercent(),
  remboursable: z.coerce.boolean().default(false),
  tauxRemboursement: optionalPercent(),
};

const descriptiveShape = {
  description: optionalTrimmed(),
  excipients: optionalTrimmed(),
  indications: optionalTrimmed(),
  posologieAdulte: optionalTrimmed(),
  posologieEnfant: optionalTrimmed(),
  contreIndicationConduite: optionalTrimmed(),
  contreIndicationAllaitement: optionalTrimmed(),
  contreIndicationGrossesse: optionalTrimmed(),
  monographie: optionalTrimmed(),
};

/**
 * A product flagged reimbursable with no rate and no base price tells a
 * pharmacist nothing — and the till would compute a zero share. One of the
 * two is enough: CNOPS supplies both, hand entry often has only the rate.
 */
function reimbursementIsUsable(data: {
  remboursable: boolean;
  tauxRemboursement?: number | null;
  prixBaseRemboursement?: number | null;
}) {
  if (!data.remboursable) return true;
  return (
    (data.tauxRemboursement ?? null) !== null || (data.prixBaseRemboursement ?? null) !== null
  );
}

const reimbursementRefinement = {
  message: "Indiquez un taux ou un prix de base de remboursement",
  path: ["tauxRemboursement"],
};

/** Étape 1 — Identification */
export const catalogueStep1Schema = z.object(identificationShape);
/** Étape 2 — Prix et fiscalité */
export const catalogueStep2Schema = z.object(pricingShape).refine(
  reimbursementIsUsable,
  reimbursementRefinement,
);
/** Étape 3 — Descriptif */
export const catalogueStep3Schema = z.object(descriptiveShape);

export const catalogueFormSchema = z
  .object({ ...identificationShape, ...pricingShape, ...descriptiveShape })
  .refine(reimbursementIsUsable, reimbursementRefinement);

export type CatalogueFormInput = z.input<typeof catalogueFormSchema>;
export type CatalogueFormValues = z.output<typeof catalogueFormSchema>;

export const CATALOGUE_STEPS = [
  { id: 1, label: "Identification" },
  { id: 2, label: "Prix et fiscalité" },
  { id: 3, label: "Descriptif" },
] as const;

/** Which step owns each field, to jump there when full-form validation fails. */
export const CATALOGUE_FIELD_STEP: Record<string, number> = {
  ...Object.fromEntries(Object.keys(identificationShape).map((key) => [key, 1])),
  ...Object.fromEntries(Object.keys(pricingShape).map((key) => [key, 2])),
  ...Object.fromEntries(Object.keys(descriptiveShape).map((key) => [key, 3])),
};
