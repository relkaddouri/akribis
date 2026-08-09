"use server";

/**
 * Read-only facade for the dashboard's aggregate stats — same seam as
 * lib/offline/products.ts, just no writes to speak of here.
 */

import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { getExpiryAlerts } from "@/lib/stock/alerts";

const EXPIRY_WINDOW_DAYS = 30;
const SALES_WINDOW_DAYS = 30;
const TOP_PRODUCTS_LIMIT = 10;

export type TopSellingProduct = {
  productId: string;
  productName: string;
  quantitySold: number;
};

export type DashboardStats = {
  totalStockValue: number;
  outOfStockCount: number;
  expiringCount: number;
  topProducts: TopSellingProduct[];
};

export async function getDashboardStats(): Promise<DashboardStats> {
  const user = await requireUser();

  const products = await prisma.product.findMany({
    where: { pharmacyId: user.pharmacyId },
    select: {
      id: true,
      name: true,
      price: true,
      quantityInStock: true,
      nearestExpiryDate: true,
    },
  });

  const totalStockValue =
    Math.round(
      products.reduce((sum, product) => sum + Number(product.price) * product.quantityInStock, 0) *
        100,
    ) / 100;

  const outOfStockCount = products.filter((product) => product.quantityInStock === 0).length;

  const expiringCount = getExpiryAlerts(
    products.map((product) => ({
      id: product.id,
      name: product.name,
      quantityInStock: product.quantityInStock,
      lowStockThreshold: 0,
      nearestExpiryDate: product.nearestExpiryDate,
    })),
    EXPIRY_WINDOW_DAYS,
  ).length;

  const since = new Date();
  since.setDate(since.getDate() - SALES_WINDOW_DAYS);

  const bestSellers = await prisma.saleItem.groupBy({
    by: ["productId"],
    where: {
      pharmacyId: user.pharmacyId,
      sale: { createdAt: { gte: since } },
    },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: TOP_PRODUCTS_LIMIT,
  });

  const productById = new Map(products.map((product) => [product.id, product]));
  const topProducts: TopSellingProduct[] = bestSellers.map((row) => ({
    productId: row.productId,
    productName: productById.get(row.productId)?.name ?? "Produit supprimé",
    quantitySold: row._sum.quantity ?? 0,
  }));

  return { totalStockValue, outOfStockCount, expiringCount, topProducts };
}
