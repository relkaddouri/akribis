/**
 * Offline-first write layer for sales, backed by Dexie (IndexedDB).
 * POS calls this — never lib/server/sales.ts directly.
 *
 * The cart's stock check and the product stock decrement both happen
 * against the local cache immediately, so a sale can be completed and a
 * ticket printed with zero connectivity. The sale itself is pushed onto
 * the sync queue and applied against Postgres by the sync engine once
 * online — where the authoritative, concurrency-safe stock check in
 * lib/server/sales.ts runs again for real.
 */

import { getDb } from "@/lib/offline/db";
import { enqueue } from "@/lib/offline/sync-queue";
import { processQueue } from "@/lib/offline/sync-engine";
import { createSaleSchema, type CreateSaleInput } from "@/lib/validations/sales";
import { round2 } from "@/lib/pos/cart";
import { calculerPartage, type LigneRemboursable } from "@/lib/pos/tiers-payant";
import type { Receipt, ReceiptLine } from "@/lib/server/sales";

export type { Receipt, ReceiptLine } from "@/lib/server/sales";

/**
 * `clientName` et `insurerTaux` servent uniquement à l'affichage optimiste
 * : le serveur résout le client depuis `clientId` et relit le taux depuis
 * l'organisme, il n'accepte ni l'un ni l'autre du client.
 */
export type OfflineCreateSaleInput = CreateSaleInput & {
  clientName?: string;
  insurerTaux?: number;
};

export async function createSale(input: OfflineCreateSaleInput): Promise<Receipt> {
  const { clientName, insurerTaux, ...rest } = input;
  const parsed = createSaleSchema.parse(rest);
  const db = getDb();
  const id = crypto.randomUUID();
  const clientTimestamp = new Date();

  const items: ReceiptLine[] = [];
  /** Les mêmes lignes, avec de quoi calculer la part de l'organisme. */
  const lignesPartage: LigneRemboursable[] = [];

  for (const line of parsed.items) {
    const product = await db.products.get(line.productId);
    if (!product) {
      throw new Error("Produit introuvable localement.");
    }
    if (line.quantity > product.quantityInStock) {
      throw new Error(
        `Stock insuffisant pour "${product.name}" (${product.quantityInStock} disponible(s)).`,
      );
    }
    items.push({
      productId: product.id,
      productName: product.name,
      quantity: line.quantity,
      unitPrice: product.price,
      lineTotal: round2(product.price * line.quantity),
    });
    lignesPartage.push({
      unitPrice: product.price,
      quantity: line.quantity,
      remboursable: product.remboursable,
      baseRemboursement: product.baseRemboursement,
    });
  }

  /**
   * Le même partage que celui que le serveur refera, calculé ici sur le
   * cache local pour que le ticket imprimé hors ligne annonce déjà les
   * deux montants.
   *
   * Le serveur reste l'autorité : il recalcule à partir de ses propres
   * données produit et du taux de l'organisme, sans jamais lire ceci.
   * `insurerTaux` n'est d'ailleurs pas envoyé — il ne sert qu'à ce ticket,
   * comme `clientName`, parce que la liste des organismes n'est pas mise
   * en cache hors ligne alors que le comptoir l'a sous les yeux.
   */
  const partage = calculerPartage(lignesPartage, insurerTaux ?? null);


  // Optimistic local decrement, so the next screen (and a concurrent
  // scan in the same cart) sees reduced stock immediately.
  await db.transaction("rw", db.products, async () => {
    for (const line of parsed.items) {
      const product = await db.products.get(line.productId);
      if (product) {
        await db.products.update(line.productId, {
          quantityInStock: product.quantityInStock - line.quantity,
        });
      }
    }
  });

  await enqueue({
    type: "createSale",
    entityId: id,
    // Prices are taken from `items`, the very lines the ticket was printed
    // from, so the queued write and the customer's paper cannot disagree.
    // Sending only {productId, quantity} let the server reprice the sale
    // from the catalogue whenever it synced later — see the pricing rule
    // at the top of lib/server/sales.ts.
    payload: {
      id,
      input: {
        ...parsed,
        items: items.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      },
    },
    clientTimestamp,
  });
  void processQueue();

  return {
    id,
    createdAt: clientTimestamp,
    paymentMethod: parsed.paymentMethod,
    totalAmount: partage.total,
    partClient: partage.partClient,
    partAssurance: partage.partAssurance,
    clientName: clientName ?? null,
    items,
    // Nothing to compare against yet: this ticket *is* the reference. Any
    // gap with the catalogue is found later, when the queued write reaches
    // the server, and reported by it.
    priceDrifts: [],
  };
}
