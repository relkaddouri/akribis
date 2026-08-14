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
 *
 * THE PRICING RULE, which the rest of this file exists to honour:
 *
 *   A sale is recorded at the price shown on the customer's ticket when
 *   it was rung up — never at the catalogue price in force when the write
 *   reaches the server.
 *
 * The two are the same thing online. They come apart offline, where a
 * queued sale can reach Postgres hours later, after the shelf price has
 * been changed. Repricing it then would mean the accounts disagree with
 * the piece of paper the customer is holding, and the customer's paper is
 * the one that is true: that is the money that changed hands.
 *
 * So `items[].unitPrice` from the till wins, and the catalogue price is
 * only a fallback for payloads that carry none. A gap between the two is
 * reported back in `Receipt.priceDrifts` — recorded, never corrected.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { createSaleSchema, type CreateSaleInput } from "@/lib/validations/sales";
import { computeLoyaltyPoints, creditSaleMovement } from "@/lib/clients/account";
import { addLoyaltyPoints, recordClientTransaction } from "@/lib/server/client-account";
import type { PaymentMethod } from "@/lib/db/generated/enums";

export type ReceiptLine = {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

/**
 * A line whose ticket price no longer matches the catalogue. Purely
 * informational — the sale is recorded at `chargedPrice` regardless — but
 * a large or frequent gap is worth someone looking at, so it travels back
 * to the caller instead of being silently discarded.
 */
export type PriceDrift = {
  productId: string;
  productName: string;
  /** What the customer paid, and what was recorded. */
  chargedPrice: number;
  /** What the product costs now, for comparison only. */
  catalogPrice: number;
};

export type Receipt = {
  id: string;
  createdAt: Date;
  paymentMethod: PaymentMethod;
  totalAmount: number;
  clientName: string | null;
  items: ReceiptLine[];
  priceDrifts: PriceDrift[];
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
    const priceDrifts: PriceDrift[] = [];

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

      // The pricing rule, applied. `??` and not `||`: a legitimate zero
      // (a free line) must not silently fall through to the catalogue.
      const catalogPrice = Number(product.price);
      const unitPrice = item.unitPrice ?? catalogPrice;

      if (item.unitPrice !== undefined && item.unitPrice !== catalogPrice) {
        priceDrifts.push({
          productId: product.id,
          productName: product.name,
          chargedPrice: unitPrice,
          catalogPrice,
        });
      }

      items.push({
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice,
        lineTotal: unitPrice * item.quantity,
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

    if (client) {
      // Both of these belong in the sale's own transaction: a sale that
      // charged the account but failed to record why (or vice versa) would
      // break the balance/history invariant that lib/server/client-account.ts
      // guarantees.
      if (parsed.paymentMethod === "CREDIT") {
        await recordClientTransaction(tx, user.pharmacyId, {
          clientId: client.id,
          type: "vente",
          montant: creditSaleMovement(totalAmount),
          saleId: sale.id,
          description: "Vente à crédit",
        });
      }

      const pharmacy = await tx.pharmacy.findUniqueOrThrow({
        where: { id: user.pharmacyId },
        select: { loyaltyRate: true },
      });
      await addLoyaltyPoints(
        tx,
        client.id,
        computeLoyaltyPoints(totalAmount, Number(pharmacy.loyaltyRate)),
      );
    }

    return {
      id: sale.id,
      createdAt: sale.createdAt,
      paymentMethod: parsed.paymentMethod,
      totalAmount,
      clientName: client?.name ?? null,
      items,
      priceDrifts,
    };
  });

  revalidatePath("/dashboard/stock");
  revalidatePath("/dashboard/clients");
  return receipt;
}
