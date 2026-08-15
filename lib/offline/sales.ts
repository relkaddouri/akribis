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
import type { Receipt, ReceiptLine } from "@/lib/server/sales";

export type { Receipt, ReceiptLine } from "@/lib/server/sales";

/** `clientName` is optimistic-display-only — the server resolves it itself from `clientId`. */
export type OfflineCreateSaleInput = CreateSaleInput & { clientName?: string };

export async function createSale(input: OfflineCreateSaleInput): Promise<Receipt> {
  const { clientName, ...rest } = input;
  const parsed = createSaleSchema.parse(rest);
  const db = getDb();
  const id = crypto.randomUUID();
  const clientTimestamp = new Date();

  const items: ReceiptLine[] = [];
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
  }

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
    totalAmount: round2(items.reduce((sum, item) => sum + item.lineTotal, 0)),
    clientName: clientName ?? null,
    items,
    // Nothing to compare against yet: this ticket *is* the reference. Any
    // gap with the catalogue is found later, when the queued write reaches
    // the server, and reported by it.
    priceDrifts: [],
  };
}
