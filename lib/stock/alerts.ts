/**
 * Pure alert-calculation logic for the stock module. Framework- and
 * data-layer-agnostic on purpose: it only needs plain product fields, so
 * it works the same whether products come from the server facade today
 * or from IndexedDB later.
 */

export const EXPIRY_THRESHOLD_OPTIONS = [30, 60, 90] as const;
export type ExpiryThresholdDays = (typeof EXPIRY_THRESHOLD_OPTIONS)[number];

export type ProductForAlerts = {
  id: string;
  name: string;
  quantityInStock: number;
  lowStockThreshold: number;
  nearestExpiryDate: Date | string | null;
};

export type LowStockAlert = {
  productId: string;
  productName: string;
  quantityInStock: number;
  lowStockThreshold: number;
};

export type ExpiryAlert = {
  productId: string;
  productName: string;
  nearestExpiryDate: Date;
  /** Negative when the product has already expired. */
  daysUntilExpiry: number;
};

export function isLowStock(
  product: Pick<ProductForAlerts, "quantityInStock" | "lowStockThreshold">,
): boolean {
  return product.quantityInStock <= product.lowStockThreshold;
}

/** Sorted with the most depleted stock first. */
export function getLowStockAlerts(products: ProductForAlerts[]): LowStockAlert[] {
  return products
    .filter(isLowStock)
    .map((product) => ({
      productId: product.id,
      productName: product.name,
      quantityInStock: product.quantityInStock,
      lowStockThreshold: product.lowStockThreshold,
    }))
    .sort((a, b) => a.quantityInStock - b.quantityInStock);
}

/**
 * Whole-day difference between `date` and `from`, ignoring time of day so
 * a product expiring later today isn't off by one due to the clock.
 */
export function daysUntil(date: Date, from: Date = new Date()): number {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  // UTC getters throughout: mixing local-time getters with Date.UTC would
  // make the result depend on the server/browser's timezone offset.
  const startOfFrom = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const startOfDate = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((startOfDate - startOfFrom) / MS_PER_DAY);
}

/**
 * Alerts for products expiring within `thresholdDays`, including already
 * expired ones (negative `daysUntilExpiry`) since those are the most
 * urgent case, not a separate concern.
 * Sorted with the most urgent (soonest/most overdue) first.
 */
export function getExpiryAlerts(
  products: ProductForAlerts[],
  thresholdDays: number,
  from: Date = new Date(),
): ExpiryAlert[] {
  return products
    .filter((product): product is ProductForAlerts & { nearestExpiryDate: Date | string } =>
      product.nearestExpiryDate !== null,
    )
    .map((product) => {
      const nearestExpiryDate =
        typeof product.nearestExpiryDate === "string"
          ? new Date(product.nearestExpiryDate)
          : product.nearestExpiryDate;
      return {
        productId: product.id,
        productName: product.name,
        nearestExpiryDate,
        daysUntilExpiry: daysUntil(nearestExpiryDate, from),
      };
    })
    .filter((alert) => alert.daysUntilExpiry <= thresholdDays)
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
}
