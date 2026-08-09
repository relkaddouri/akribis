"use server";

/**
 * Server-side, Prisma-backed sync target for purchase orders — see the
 * note at the top of lib/server/products.ts.
 *
 * `listOrders`/`getOrder`/`createOrder` are still called directly (order
 * planning isn't offline-critical); `receiveOrder` is also called
 * directly here by the sync engine — receiving is the offline-critical
 * one, handled by lib/offline/orders.ts on the client side. It's the
 * other transactional write in this codebase (alongside
 * lib/server/sales.ts's createSale): it increments stock, tracks how
 * much of each line has been received so far, and recomputes the
 * order's status, all together.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import {
  orderFormSchema,
  receiveOrderSchema,
  type OrderFormInput,
  type ReceiveOrderInput,
} from "@/lib/validations/orders";
import type { OrderModel } from "@/lib/db/generated/models";
import type { OrderStatus } from "@/lib/db/generated/enums";

export type OrderListItem = {
  id: string;
  status: OrderStatus;
  createdAt: Date;
  supplierId: string;
  supplierName: string;
  itemCount: number;
};

export type OrderItemRecord = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  receivedQuantity: number;
  unitPrice: number;
};

export type OrderRecord = {
  id: string;
  status: OrderStatus;
  createdAt: Date;
  supplierId: string;
  supplierName: string;
  items: OrderItemRecord[];
};

export async function listOrders(): Promise<OrderListItem[]> {
  const user = await requireUser();

  const orders = await prisma.order.findMany({
    where: { pharmacyId: user.pharmacyId },
    orderBy: { createdAt: "desc" },
    include: {
      supplier: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });

  return orders.map((order) => ({
    id: order.id,
    status: order.status,
    createdAt: order.createdAt,
    supplierId: order.supplierId,
    supplierName: order.supplier.name,
    itemCount: order._count.items,
  }));
}

export async function getOrder(id: string): Promise<OrderRecord | null> {
  const user = await requireUser();

  const order = await prisma.order.findFirst({
    where: { id, pharmacyId: user.pharmacyId },
    include: {
      supplier: { select: { name: true } },
      items: { include: { product: { select: { name: true } } } },
    },
  });
  if (!order) return null;

  return {
    id: order.id,
    status: order.status,
    createdAt: order.createdAt,
    supplierId: order.supplierId,
    supplierName: order.supplier.name,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.product.name,
      quantity: item.quantity,
      receivedQuantity: item.receivedQuantity,
      unitPrice: Number(item.unitPrice),
    })),
  };
}

export async function createOrder(input: OrderFormInput): Promise<OrderModel> {
  const user = await requireUser();
  const data = orderFormSchema.parse(input);

  const supplier = await prisma.supplier.findFirst({
    where: { id: data.supplierId, pharmacyId: user.pharmacyId },
    select: { id: true },
  });
  if (!supplier) {
    throw new Error("Fournisseur introuvable.");
  }

  const productIds = [...new Set(data.items.map((item) => item.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, pharmacyId: user.pharmacyId },
    select: { id: true },
  });
  if (products.length !== productIds.length) {
    throw new Error("Un ou plusieurs produits sont introuvables.");
  }

  const order = await prisma.order.create({
    data: {
      pharmacyId: user.pharmacyId,
      supplierId: data.supplierId,
      status: "PENDING",
      items: {
        create: data.items.map((item) => ({
          pharmacyId: user.pharmacyId,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      },
    },
  });

  revalidatePath("/dashboard/commandes");
  return order;
}

/**
 * Records how much of each order line arrived in this delivery,
 * increments stock accordingly, and recomputes the order's overall
 * status (pending / partially received / received) from the up-to-date
 * totals — supports being called more than once for the same order as
 * deliveries arrive in multiple batches.
 *
 * A requested quantity beyond what's still outstanding on a line is
 * clamped, not rejected: over-reporting a receipt shouldn't block
 * recording the part that is valid.
 */
export async function receiveOrder(
  orderId: string,
  input: ReceiveOrderInput,
): Promise<OrderRecord> {
  const user = await requireUser();
  const parsed = receiveOrderSchema.parse(input);

  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, pharmacyId: user.pharmacyId },
      include: { items: true },
    });
    if (!order) {
      throw new Error("Commande introuvable.");
    }

    const requestedByLine = new Map(
      parsed.lines.map((line) => [line.orderItemId, line.receivedQuantity]),
    );

    let allReceived = true;
    let anyReceived = false;

    for (const item of order.items) {
      const requested = requestedByLine.get(item.id) ?? 0;
      const remaining = item.quantity - item.receivedQuantity;
      const toReceive = Math.max(0, Math.min(requested, remaining));

      if (toReceive > 0) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: { receivedQuantity: { increment: toReceive } },
        });

        await tx.product.update({
          where: { id: item.productId },
          data: { quantityInStock: { increment: toReceive } },
        });

        await tx.stockMovement.create({
          data: {
            pharmacyId: user.pharmacyId,
            productId: item.productId,
            type: "IN",
            quantity: toReceive,
            reason: `Réception commande ${orderId}`,
          },
        });
      }

      const newTotal = item.receivedQuantity + toReceive;
      if (newTotal < item.quantity) allReceived = false;
      if (newTotal > 0) anyReceived = true;
    }

    const status: OrderStatus = allReceived
      ? "RECEIVED"
      : anyReceived
        ? "PARTIALLY_RECEIVED"
        : "PENDING";

    await tx.order.update({ where: { id: orderId }, data: { status } });
  });

  revalidatePath("/dashboard/commandes");
  revalidatePath("/dashboard/stock");
  revalidatePath(`/dashboard/commandes/${orderId}`);

  const updated = await getOrder(orderId);
  if (!updated) {
    throw new Error("Commande introuvable après réception.");
  }
  return updated;
}
