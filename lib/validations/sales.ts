import { z } from "zod";

export const createSaleSchema = z.object({
  paymentMethod: z.enum(["CASH", "CARD"], { message: "Moyen de paiement invalide" }),
  clientId: z.string().min(1).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int("Nombre entier requis").positive("Doit être > 0"),
      }),
    )
    .min(1, "Le panier est vide"),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
