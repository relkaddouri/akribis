import { z } from "zod";

export const createSaleSchema = z.object({
  paymentMethod: z.enum(["CASH", "CARD", "CREDIT"], { message: "Moyen de paiement invalide" }),
  clientId: z.string().min(1).optional(),
  /**
   * L'organisme de tiers payant retenu pour cette vente. Absent = vente
   * payée intégralement par le client.
   *
   * Seul l'identifiant traverse : les montants sont recalculés côté
   * serveur, à partir de ses propres données produit et du taux de
   * l'organisme. Un panier qui enverrait ses montants pourrait annoncer
   * n'importe quelle part assurance.
   */
  insurerId: z.string().min(1).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int("Nombre entier requis").positive("Doit être > 0"),
        /**
         * Price actually charged, captured when the sale was rung up.
         *
         * Optional only for items queued before this field existed; the
         * till always sends it. Validated, not trusted blindly: a negative
         * price would turn a sale into a refund.
         */
        unitPrice: z.coerce.number().min(0, "Doit être ≥ 0").optional(),
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
