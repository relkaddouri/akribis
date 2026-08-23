import { z } from "zod";

function optionalTrimmed() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : null));
}

export const pharmacyInfoSchema = z.object({
  name: z.string().trim().min(1, "Nom requis"),
  /// Dirhams that earn one loyalty point. 0 disables the programme.
  loyaltyRate: z.coerce
    .number({ message: "Taux invalide" })
    .min(0, "Le taux ne peut pas être négatif"),
  address: optionalTrimmed(),
  phone: optionalTrimmed(),
  ice: optionalTrimmed(),
  identifiantFiscal: optionalTrimmed(),
  orderNumber: optionalTrimmed(),
  inpe: optionalTrimmed(),
  patente: optionalTrimmed(),
});

export type PharmacyInfoInput = z.input<typeof pharmacyInfoSchema>;

export const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;

export const receiptSettingsSchema = z.object({
  showLogo: z.boolean(),
  legalNotice: optionalTrimmed(),
  thankYouMessage: optionalTrimmed(),
});

export type ReceiptSettingsInput = z.input<typeof receiptSettingsSchema>;
export type ReceiptSettings = z.output<typeof receiptSettingsSchema>;

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  showLogo: true,
  legalNotice: null,
  thankYouMessage: null,
};

/** Merges a possibly-partial/legacy JSON blob with defaults for missing keys. */
export function parseReceiptSettings(value: unknown): ReceiptSettings {
  const parsed = receiptSettingsSchema.partial().safeParse(value);
  if (!parsed.success) return DEFAULT_RECEIPT_SETTINGS;
  return { ...DEFAULT_RECEIPT_SETTINGS, ...parsed.data };
}

/**
 * Un organisme de tiers payant.
 *
 * Le taux est borné à 0–100 : c'est un pourcentage de prise en charge, et
 * 150 % n'est pas une négociation avantageuse mais une faute de frappe qui
 * fausserait chaque vente jusqu'à ce que quelqu'un s'en aperçoive.
 */
export const organismeSchema = z.object({
  nom: z.string().trim().min(1, "Nom requis"),
  code: z.string().trim().min(1, "Code requis"),
  tauxCouverture: z.coerce
    .number({ message: "Taux invalide" })
    .min(0, "Le taux ne peut pas être négatif")
    .max(100, "Le taux ne peut pas dépasser 100 %"),
  formatBordereau: optionalTrimmed(),
});

export type OrganismeInput = z.input<typeof organismeSchema>;
