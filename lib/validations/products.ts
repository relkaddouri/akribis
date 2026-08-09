import { z } from "zod";

function optionalTrimmed() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : null));
}

/** Coerces "" (an empty number input) to undefined instead of 0/NaN. */
function optionalNumber() {
  return z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : value),
    z.coerce.number().optional(),
  );
}

export const PRODUCT_CATEGORIES = [
  "Antalgiques / Antipyrétiques",
  "Antibiotiques",
  "Anti-inflammatoires",
  "Antihistaminiques / Allergie",
  "Cardiologie / Antihypertenseurs",
  "Diabète / Antidiabétiques",
  "Gastro-entérologie",
  "Dermatologie",
  "ORL / Voies respiratoires",
  "Gynécologie",
  "Ophtalmologie",
  "Vitamines et compléments alimentaires",
  "Pédiatrie",
  "Contraception",
  "Psychotropes / Neurologie",
  "Parapharmacie / Hygiène",
  "Matériel médical",
  "Autres",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

const step1Shape = {
  name: z.string().trim().min(1, "Nom requis"),
  form: z.string().trim().min(1, "Forme requise"),
  dosage: optionalTrimmed(),
  laboratory: optionalTrimmed(),
  barcode: optionalTrimmed(),
  dci: optionalTrimmed(),
  photoUrl: optionalTrimmed(),
  category: z
    .union([z.enum(PRODUCT_CATEGORIES), z.literal("")])
    .optional()
    .transform((value) => (value ? value : null)),
};

const step2Shape = {
  price: z.coerce.number().min(0, "Doit être ≥ 0"),
  purchasePrice: optionalNumber(),
  pph: optionalNumber(),
  tvaVente: optionalNumber(),
  tvaAchat: optionalNumber(),
  quantityInStock: z.coerce.number().int("Nombre entier requis").min(0, "Doit être ≥ 0"),
  lowStockThreshold: z.coerce.number().int("Nombre entier requis").min(0, "Doit être ≥ 0"),
  // Plain "YYYY-MM-DD" from a <input type="date">; converted to a Date
  // in the data facade, not here, so this schema stays serializable.
  nearestExpiryDate: optionalTrimmed(),
};

const step3Shape = {
  remboursable: z.coerce.boolean().default(false),
  baseRemboursement: optionalNumber(),
};

function reimbursementIsConsistent(data: { remboursable: boolean; baseRemboursement?: number }) {
  return !data.remboursable || data.baseRemboursement !== undefined;
}
const reimbursementRefinement = {
  message: "Base de remboursement requise",
  path: ["baseRemboursement"],
};

const step4Shape = {
  posologieEnfant: optionalTrimmed(),
  posologieAdulte: optionalTrimmed(),
  monographie: optionalTrimmed(),
};

/** Étape 1 — Infos générales */
export const productStep1Schema = z.object(step1Shape);
/** Étape 2 — Prix et fiscalité */
export const productStep2Schema = z.object(step2Shape);
/** Étape 3 — Remboursement */
export const productStep3Schema = z.object(step3Shape).refine(reimbursementIsConsistent, reimbursementRefinement);
/** Étape 4 — Posologie et monographie */
export const productStep4Schema = z.object(step4Shape);

export const productFormSchema = z
  .object({ ...step1Shape, ...step2Shape, ...step3Shape, ...step4Shape })
  .refine(reimbursementIsConsistent, reimbursementRefinement);

export type ProductFormInput = z.input<typeof productFormSchema>;
export type ProductFormValues = z.output<typeof productFormSchema>;
