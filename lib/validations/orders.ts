import { z } from "zod";

function optionalTrimmed() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : null));
}

export const supplierFormSchema = z.object({
  name: z.string().trim().min(1, "Nom requis"),
  phone: optionalTrimmed(),
  email: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : null))
    .refine((value) => !value || z.string().email().safeParse(value).success, {
      message: "Adresse e-mail invalide",
    }),
});

export type SupplierFormInput = z.input<typeof supplierFormSchema>;

export const orderFormSchema = z.object({
  supplierId: z.string().min(1, "Fournisseur requis"),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int("Nombre entier requis").positive("Doit être > 0"),
        unitPrice: z.coerce.number().min(0, "Doit être ≥ 0"),
      }),
    )
    .min(1, "La commande doit contenir au moins un produit"),
});

export type OrderFormInput = z.input<typeof orderFormSchema>;

export const receiveOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        receivedQuantity: z.coerce.number().int("Nombre entier requis").min(0, "Doit être ≥ 0"),
      }),
    )
    .min(1),
});

export type ReceiveOrderInput = z.infer<typeof receiveOrderSchema>;
