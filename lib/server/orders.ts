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
import { allocateDocumentNumber } from "@/lib/server/sequences";
import { Prisma } from "@/lib/db/generated/client";
import { allocateCredits } from "@/lib/suppliers/credit-allocation";
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
  numero: number;
  status: OrderStatus;
  createdAt: Date;
  supplierId: string;
  supplierName: string;
  itemCount: number;
  /** Ordered value: sum of quantity × unit price across the lines. */
  totalAmount: number;
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
  numero: number;
  status: OrderStatus;
  createdAt: Date;
  dateEnvoi: Date | null;
  supplierId: string;
  supplierName: string;
  supplierPhone: string | null;
  supplierEmail: string | null;
  items: OrderItemRecord[];
  totalAmount: number;
};

/** One received shipment against the order, with what actually arrived. */
export type OrderDeliveryRecord = {
  id: string;
  numero: number;
  dateReception: Date;
  lines: Array<{ productName: string; quantiteRecue: number }>;
};

/** A credit note raised against this order, whatever stage it's at. */
export type OrderCreditRecord = {
  id: string;
  numero: number;
  statut: "emis" | "recu";
  motif: string;
  montant: number;
  dateEmission: Date;
  dateReception: Date | null;
  lieRappelLot: boolean;
};

/** Everything the order detail page shows, in one round trip. */
export type OrderDetail = OrderRecord & {
  deliveries: OrderDeliveryRecord[];
  credits: OrderCreditRecord[];
};

export async function listOrders(): Promise<OrderListItem[]> {
  const user = await requireUser();

  const orders = await prisma.order.findMany({
    where: { pharmacyId: user.pharmacyId },
    orderBy: { createdAt: "desc" },
    include: {
      supplier: { select: { name: true } },
      // The lines themselves, not just a count: the list shows the ordered
      // value, and Prisma can't sum a computed quantity × price for us.
      items: { select: { quantity: true, unitPrice: true } },
    },
  });

  return orders.map((order) => ({
    id: order.id,
    numero: order.numero,
    status: order.status,
    createdAt: order.createdAt,
    supplierId: order.supplierId,
    supplierName: order.supplier.name,
    itemCount: order.items.length,
    totalAmount:
      Math.round(
        order.items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0) * 100,
      ) / 100,
  }));
}

export async function getOrder(id: string): Promise<OrderRecord | null> {
  const user = await requireUser();

  const order = await prisma.order.findFirst({
    where: { id, pharmacyId: user.pharmacyId },
    include: {
      supplier: { select: { name: true, phone: true, email: true } },
      items: { include: { product: { select: { name: true } } } },
    },
  });
  if (!order) return null;

  const items = order.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    productName: item.product.name,
    quantity: item.quantity,
    receivedQuantity: item.receivedQuantity,
    unitPrice: Number(item.unitPrice),
  }));

  return {
    id: order.id,
    numero: order.numero,
    status: order.status,
    createdAt: order.createdAt,
    dateEnvoi: order.dateEnvoi,
    supplierId: order.supplierId,
    supplierName: order.supplier.name,
    supplierPhone: order.supplier.phone,
    supplierEmail: order.supplier.email,
    items,
    totalAmount:
      Math.round(items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0) * 100) / 100,
  };
}

/** One delivery note, with the ordered quantities it settles against. */
export type DeliveryNoteRecord = {
  id: string;
  numero: number;
  dateReception: Date;
  orderNumero: number;
  supplierName: string;
  lines: Array<{ productName: string; quantiteCommandee: number; quantiteRecue: number }>;
};

export async function getDelivery(deliveryId: string): Promise<DeliveryNoteRecord | null> {
  const user = await requireUser();

  const delivery = await prisma.delivery.findFirst({
    where: { id: deliveryId, pharmacyId: user.pharmacyId },
    include: {
      order: { select: { numero: true, supplier: { select: { name: true } } } },
      items: {
        include: {
          product: { select: { name: true } },
          // The ordered quantity lives on the order line, not the delivery
          // line — the note shows the gap between the two.
          orderItem: { select: { quantity: true } },
        },
      },
    },
  });
  if (!delivery) return null;

  return {
    id: delivery.id,
    numero: delivery.numero,
    dateReception: delivery.dateReception,
    orderNumero: delivery.order.numero,
    supplierName: delivery.order.supplier.name,
    lines: delivery.items.map((item) => ({
      productName: item.product.name,
      quantiteCommandee: item.orderItem.quantity,
      quantiteRecue: item.quantiteRecue,
    })),
  };
}

/**
 * The order plus its deliveries and credit notes — the whole lifecycle the
 * detail page renders as a timeline. Fetched together rather than in three
 * calls so the page can't show a half-updated picture.
 */
export async function getOrderDetail(id: string): Promise<OrderDetail | null> {
  const user = await requireUser();

  const order = await getOrder(id);
  if (!order) return null;

  const [deliveries, credits] = await Promise.all([
    prisma.delivery.findMany({
      where: { orderId: id, pharmacyId: user.pharmacyId },
      orderBy: { dateReception: "asc" },
      include: { items: { include: { product: { select: { name: true } } } } },
    }),
    prisma.supplierCredit.findMany({
      where: { orderId: id, pharmacyId: user.pharmacyId },
      orderBy: { dateEmission: "asc" },
    }),
  ]);

  return {
    ...order,
    deliveries: deliveries.map((delivery) => ({
      id: delivery.id,
      numero: delivery.numero,
      dateReception: delivery.dateReception,
      lines: delivery.items.map((item) => ({
        productName: item.product.name,
        quantiteRecue: item.quantiteRecue,
      })),
    })),
    credits: credits.map((credit) => ({
      id: credit.id,
      numero: credit.numero,
      statut: credit.statut.toLowerCase() as "emis" | "recu",
      motif: credit.motif.toLowerCase(),
      montant: Number(credit.montant),
      dateEmission: credit.dateEmission,
      dateReception: credit.dateReception,
      lieRappelLot: credit.lieRappelLot,
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

  const order = await prisma.$transaction(async (tx) => {
    const numero = await allocateDocumentNumber(tx, user.pharmacyId, "order");

    // Credits are consumed inside the order's own transaction: an order that
    // saved without marking its credits spent would let the same credit be
    // applied again on the next one.
    const creditIds = data.creditIds ?? [];
    if (creditIds.length > 0) {
      const credits = await tx.supplierCredit.findMany({
        where: {
          id: { in: creditIds },
          pharmacyId: user.pharmacyId,
          supplierId: data.supplierId,
          statut: "RECU",
          modeCompensation: "AVOIR_CREDIT",
          montantRestant: { gt: 0 },
        },
        orderBy: { dateEmission: "asc" },
        select: { id: true, numero: true, montantRestant: true },
      });
      if (credits.length !== creditIds.length) {
        throw new Error("Un ou plusieurs avoirs ne sont plus disponibles.");
      }

      const orderTotal = data.items.reduce(
        (sum, item) => sum + Number(item.unitPrice) * Number(item.quantity),
        0,
      );
      const allocation = allocateCredits(
        orderTotal,
        credits.map((credit) => ({
          id: credit.id,
          numero: credit.numero,
          montantRestant: Number(credit.montantRestant),
        })),
      );

      for (const entry of allocation.consumed) {
        // Conditional decrement, same guard as stock: the `gte` check runs
        // inside the UPDATE, so two orders submitted at once can't both
        // spend the same remaining balance.
        const updated = await tx.supplierCredit.updateMany({
          where: {
            id: entry.id,
            pharmacyId: user.pharmacyId,
            montantRestant: { gte: new Prisma.Decimal(entry.amount) },
          },
          data: { montantRestant: { decrement: new Prisma.Decimal(entry.amount) } },
        });
        if (updated.count === 0) {
          throw new Error("Un avoir a été utilisé entre-temps — rechargez la page.");
        }
      }
    }

    // Creating an order here means placing it: there is no draft step in
    // the UI yet, so it goes straight to ENVOYEE with a send date rather
    // than sitting in BROUILLON with no way to advance it.
    return tx.order.create({
      data: {
        pharmacyId: user.pharmacyId,
        supplierId: data.supplierId,
        numero,
        status: "ENVOYEE",
        dateEnvoi: new Date(),
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
  });

  revalidatePath("/commandes");
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

    // Every reception is now a delivery note in its own right, with its own
    // sequence: an order receiving three partial shipments leaves three
    // traceable documents instead of a single running total on OrderItem.
    const deliveryNumero = await allocateDocumentNumber(tx, user.pharmacyId, "delivery");
    const delivery = await tx.delivery.create({
      data: { pharmacyId: user.pharmacyId, orderId: order.id, numero: deliveryNumero },
      select: { id: true },
    });

    for (const item of order.items) {
      const requested = requestedByLine.get(item.id) ?? 0;
      const remaining = item.quantity - item.receivedQuantity;
      const toReceive = Math.max(0, Math.min(requested, remaining));

      if (toReceive > 0) {
        await tx.deliveryItem.create({
          data: {
            deliveryId: delivery.id,
            orderItemId: item.id,
            productId: item.productId,
            quantiteRecue: toReceive,
          },
        });

        // Kept alongside the delivery lines: OrderItem.receivedQuantity is
        // the denormalised running total the "remaining" maths reads, in
        // the same transaction as the lines it summarises.
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
            reason: `Réception commande ${order.numero} — BL ${deliveryNumero}`,
          },
        });
      }

      const newTotal = item.receivedQuantity + toReceive;
      if (newTotal < item.quantity) allReceived = false;
      if (newTotal > 0) anyReceived = true;
    }

    const status: OrderStatus = allReceived
      ? "RECUE"
      : anyReceived
        ? "PARTIELLEMENT_RECUE"
        : "ENVOYEE";

    await tx.order.update({ where: { id: orderId }, data: { status } });
  });

  revalidatePath("/commandes");
  revalidatePath("/dashboard/stock");
  revalidatePath(`/commandes/${orderId}`);

  const updated = await getOrder(orderId);
  if (!updated) {
    throw new Error("Commande introuvable après réception.");
  }
  return updated;
}
