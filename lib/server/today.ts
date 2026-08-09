"use server";

/**
 * "Aujourd'hui en un coup d'œil" — the compact stats shown beside the
 * actualités feed. Everything here is derived from real sales/products
 * rows for the caller's own pharmacy; nothing is stubbed.
 */

import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { getLowStockAlerts } from "@/lib/stock/alerts";

export type TodayGlance = {
  /** Total sales amount booked since midnight, in dirhams. */
  salesTotal: number;
  /** Products at or below their low-stock threshold. */
  lowStockCount: number;
  /** Best-selling product since midnight, or null when nothing sold yet. */
  topProduct: { name: string; quantity: number } | null;
};

function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

export async function getTodayGlance(): Promise<TodayGlance> {
  const user = await requireUser();
  const since = startOfToday();

  const [salesAggregate, products, bestSeller] = await Promise.all([
    prisma.sale.aggregate({
      where: { pharmacyId: user.pharmacyId, createdAt: { gte: since } },
      _sum: { totalAmount: true },
    }),
    prisma.product.findMany({
      where: { pharmacyId: user.pharmacyId },
      select: { id: true, name: true, quantityInStock: true, lowStockThreshold: true },
    }),
    prisma.saleItem.groupBy({
      by: ["productId"],
      where: { pharmacyId: user.pharmacyId, sale: { createdAt: { gte: since } } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 1,
    }),
  ]);

  const lowStockCount = getLowStockAlerts(
    products.map((product) => ({ ...product, nearestExpiryDate: null })),
  ).length;

  const best = bestSeller[0];
  const bestName = best ? products.find((p) => p.id === best.productId)?.name : undefined;

  return {
    salesTotal: Number(salesAggregate._sum.totalAmount ?? 0),
    lowStockCount,
    topProduct:
      best && bestName ? { name: bestName, quantity: best._sum.quantity ?? 0 } : null,
  };
}
