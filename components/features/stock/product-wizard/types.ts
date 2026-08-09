import type { ProductCategory } from "@/lib/validations/products";

/**
 * Everything the wizard holds in memory across steps. Numeric/date
 * fields stay as strings (native <input> value type) and are only
 * coerced when a Zod schema parses them — same convention the rest of
 * the app's forms use.
 */
export type WizardState = {
  name: string;
  form: string;
  dosage: string;
  laboratory: string;
  barcode: string;
  dci: string;
  photoUrl: string;
  category: ProductCategory | "";

  price: string;
  pph: string;
  tvaVente: string;
  tvaAchat: string;
  quantityInStock: string;
  lowStockThreshold: string;
  nearestExpiryDate: string;

  remboursable: boolean;
  baseRemboursement: string;

  posologieEnfant: string;
  posologieAdulte: string;
  monographie: string;
};

export const EMPTY_WIZARD_STATE: WizardState = {
  name: "",
  form: "",
  dosage: "",
  laboratory: "",
  barcode: "",
  dci: "",
  photoUrl: "",
  category: "",
  price: "0",
  pph: "",
  tvaVente: "",
  tvaAchat: "",
  quantityInStock: "0",
  lowStockThreshold: "0",
  nearestExpiryDate: "",
  remboursable: false,
  baseRemboursement: "",
  posologieEnfant: "",
  posologieAdulte: "",
  monographie: "",
};

function toDateInputValue(date: Date | string | null | undefined): string {
  if (!date) return "";
  const parsed = typeof date === "string" ? new Date(date) : date;
  return parsed.toISOString().slice(0, 10);
}

/** Structural shape shared by both the offline and server ProductRecord types. */
export type ProductLike = {
  id: string;
  name: string;
  form: string;
  dosage: string | null;
  laboratory: string | null;
  barcode: string | null;
  dci: string | null;
  photoUrl: string | null;
  category: string | null;
  price: number;
  pph: number | null;
  tvaVente: number | null;
  tvaAchat: number | null;
  quantityInStock: number;
  lowStockThreshold: number;
  nearestExpiryDate: Date | string | null;
  remboursable: boolean;
  baseRemboursement: number | null;
  posologieEnfant: string | null;
  posologieAdulte: string | null;
  monographie: string | null;
};

export function productToWizardState(product: ProductLike): WizardState {
  return {
    name: product.name,
    form: product.form,
    dosage: product.dosage ?? "",
    laboratory: product.laboratory ?? "",
    barcode: product.barcode ?? "",
    dci: product.dci ?? "",
    photoUrl: product.photoUrl ?? "",
    category: (product.category as ProductCategory | null) ?? "",
    price: String(product.price),
    pph: product.pph !== null ? String(product.pph) : "",
    tvaVente: product.tvaVente !== null ? String(product.tvaVente) : "",
    tvaAchat: product.tvaAchat !== null ? String(product.tvaAchat) : "",
    quantityInStock: String(product.quantityInStock),
    lowStockThreshold: String(product.lowStockThreshold),
    nearestExpiryDate: toDateInputValue(product.nearestExpiryDate),
    remboursable: product.remboursable,
    baseRemboursement: product.baseRemboursement !== null ? String(product.baseRemboursement) : "",
    posologieEnfant: product.posologieEnfant ?? "",
    posologieAdulte: product.posologieAdulte ?? "",
    monographie: product.monographie ?? "",
  };
}

export const WIZARD_STEPS = [
  { id: 1, label: "Infos générales" },
  { id: 2, label: "Prix et fiscalité" },
  { id: 3, label: "Remboursement" },
  { id: 4, label: "Posologie" },
] as const;

/** Which step each field belongs to, used to jump to the right step when a full-schema validation fails. */
export const FIELD_STEP: Record<string, number> = {
  name: 1,
  form: 1,
  dosage: 1,
  laboratory: 1,
  barcode: 1,
  dci: 1,
  photoUrl: 1,
  category: 1,
  price: 2,
  pph: 2,
  tvaVente: 2,
  tvaAchat: 2,
  quantityInStock: 2,
  lowStockThreshold: 2,
  nearestExpiryDate: 2,
  remboursable: 3,
  baseRemboursement: 3,
  posologieEnfant: 4,
  posologieAdulte: 4,
  monographie: 4,
};
