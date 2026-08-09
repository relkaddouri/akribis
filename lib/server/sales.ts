"use server";

/**
 * Server-side, Prisma-backed sync target for sales — see the note at
 * the top of lib/server/products.ts. Client components go through
 * lib/offline/sales.ts's Dexie-backed `createSale` instead.
 *
 * This function is the one write in this codebase that must be a real,
 * atomic transaction: it decrements stock, records the sale and its
 * line items, and logs a stock movement, and all of it has to succeed
 * or fail together — a half-applied sale (stock decremented but no sale
 * row, or vice versa) would corrupt the inventory.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { createSaleSchema, type CreateSaleInput } from "@/lib/validations/sales";
import type { PaymentMethod } from "@/lib/db/generated/enums";

export type ReceiptLine = {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type Receipt = {
  id: string;
  createdAt: Date;
  paymentMethod: PaymentMethod;
  totalAmount: number;
  clientName: string | null;
  items: ReceiptLine[];
};

export async function createSale(
  input: CreateSaleInput,
  options?: { id?: string },
): Promise<Receipt> {
  const user = await requireUser();
  const parsed = createSaleSchema.parse(input);

  const receipt = await prisma.$transaction(async (tx) => {
    // Tenant-scoped, same as products below: a tampered clientId from
    // another pharmacy must not be attachable to this sale.
    let client: { id: string; name: string } | null = null;
    if (parsed.clientId) {
      client = await tx.client.findFirst({
        where: { id: parsed.clientId, pharmacyId: user.pharmacyId },
        select: { id: true, name: true },
      });
      if (!client) {
        throw new Error("Client introuvable.");
      }
    }

    const productIds = [...new Set(parsed.items.map((item) => item.productId))];
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, pharmacyId: user.pharmacyId },
    });
    if (products.length !== productIds.length) {
      throw new Error("Un ou plusieurs produits sont introuvables.");
    }
    const productById = new Map(products.map((product) => [product.id, product]));

    const items: ReceiptLine[] = [];

    for (const item of parsed.items) {
      const product = productById.get(item.productId)!;

      // Atomic conditional decrement: the `quantityInStock >= item.quantity`
      // check happens inside the same UPDATE statement Postgres executes,
      // so two concurrent sales can't both pass a separate "is there
      // enough stock?" read and then both decrement below zero. If
      // another sale already took the stock, this matches zero rows.
      const decremented = await tx.product.updateMany({
        where: {
          id: product.id,
          pharmacyId: user.pharmacyId,
          quantityInStock: { gte: item.quantity },
        },
        data: { quantityInStock: { decrement: item.quantity } },
      });
      if (decremented.count === 0) {
        throw new Error(
          `Stock insuffisant pour "${product.name}" (${product.quantityInStock} disponible(s)).`,
        );
      }

      items.push({
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: Number(product.price),
        lineTotal: Number(product.price) * item.quantity,
      });
    }

    const totalAmount = items.reduce((sum, item) => sum + item.lineTotal, 0);

    const sale = await tx.sale.create({
      data: {
        // Same rationale as products: lets the offline layer's
        // client-generated id survive the round trip to the server.
        ...(options?.id ? { id: options.id } : {}),
        pharmacyId: user.pharmacyId,
        userId: user.id,
        clientId: client?.id ?? null,
        paymentMethod: parsed.paymentMethod,
        totalAmount,
      },
    });

    for (const item of items) {
      await tx.saleItem.create({
        data: {
          pharmacyId: user.pharmacyId,
          saleId: sale.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        },
      });

      await tx.stockMovement.create({
        data: {
          pharmacyId: user.pharmacyId,
          productId: item.productId,
          type: "OUT",
          quantity: item.quantity,
          reason: `Vente ${sale.id}`,
        },
      });
    }

    return {
      id: sale.id,
      createdAt: sale.createdAt,
      paymentMethod: parsed.paymentMethod,
      totalAmount,
      clientName: client?.name ?? null,
      items,
    };
  });

  revalidatePath("/dashboard/stock");
  revalidatePath("/dashboard/clients");
  return receipt;
}
