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
  address: optionalTrimmed(),
  phone: optionalTrimmed(),
  ice: optionalTrimmed(),
  orderNumber: optionalTrimmed(),
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
