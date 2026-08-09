/**
 * Offline-first write layer for receiving purchase orders, backed by
 * Dexie (IndexedDB). The receiving screen calls this — never
 * lib/server/orders.ts's `receiveOrder` directly. Order creation,
 * listing and detail stay server-only (planning a purchase isn't
 * offline-critical the way receiving a delivery in the stockroom is) —
 * import those from lib/server/orders.ts.
 *
 * There's no local order/order-item cache, so the caller (the receive
 * screen, which already has the order loaded as a prop) passes the
 * orderItemId -> productId mapping needed to bump local stock
 * optimistically; the sync engine applies the real, status-recomputing
 * write against Postgres once online.
 */

import { getDb } from "@/lib/offline/db";
import { enqueue } from "@/lib/offline/sync-queue";
import { processQueue } from "@/lib/offline/sync-engine";
import { receiveOrderSchema, type ReceiveOrderInput } from "@/lib/validations/orders";

export type ReceiveOrderContext = {
  lines: Array<{ orderItemId: string; productId: string }>;
};

export async function receiveOrder(
  orderId: string,
  input: ReceiveOrderInput,
  context: ReceiveOrderContext,
): Promise<void> {
  const parsed = receiveOrderSchema.parse(input);
  const db = getDb();
  const clientTimestamp = new Date();
  const productIdByItem = new Map(context.lines.map((line) => [line.orderItemId, line.productId]));

  await db.transaction("rw", db.products, async () => {
    for (const line of parsed.lines) {
      if (line.receivedQuantity <= 0) continue;
      const productId = productIdByItem.get(line.orderItemId);
      if (!productId) continue;
      const product = await db.products.get(productId);
      if (product) {
        await db.products.update(productId, {
          quantityInStock: product.quantityInStock + line.receivedQuantity,
        });
      }
    }
  });

  await enqueue({
    type: "receiveOrder",
    entityId: orderId,
    payload: { orderId, input: parsed },
    clientTimestamp,
  });
  void processQueue();
}
