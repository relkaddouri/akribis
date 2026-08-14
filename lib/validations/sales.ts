import { z } from "zod";

export const createSaleSchema = z.object({
  paymentMethod: z.enum(["CASH", "CARD", "CREDIT"], { message: "Moyen de paiement invalide" }),
  clientId: z.string().min(1).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int("Nombre entier requis").positive("Doit être > 0"),
      }),
    )
    .min(1, "Le panier est vide"),
})
  // A credit sale has to be owed by somebody: without a client there is
  // no account to charge and no way to collect later.
  .refine((value) => value.paymentMethod !== "CREDIT" || Boolean(value.clientId), {
    message: "Une vente à crédit exige un client associé.",
    path: ["paymentMethod"],
  });

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
