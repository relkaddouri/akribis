/**
 * Pure alert-calculation logic for the stock module. Framework- and
 * data-layer-agnostic on purpose: it only needs plain product fields, so
 * it works the same whether products come from the server facade today
 * or from IndexedDB later.
 */

import { valeurDuStock } from "@/lib/stock/prix";

export const EXPIRY_THRESHOLD_OPTIONS = [30, 60, 90] as const;
export type ExpiryThresholdDays = (typeof EXPIRY_THRESHOLD_OPTIONS)[number];

export type ProductForAlerts = {
  id: string;
  name: string;
  quantityInStock: number;
  lowStockThreshold: number;
  nearestExpiryDate: Date | string | null;
  /**
   * Optionnels : les compteurs du tableau de bord construisent ces objets
   * sans eux et n'ont besoin que d'un nombre. La liste du stock, elle, les
   * fournit — c'est ce qui permet de dire ce qui est en jeu, et de
   * distinguer deux DOLIPRANE qui ne diffèrent que par leur forme.
   */
  price?: number | null;
  form?: string | null;
  dosage?: string | null;
};

/** « Comprimé sécable · 1 g » — ce qui sépare deux produits homonymes. */
function precision(product: ProductForAlerts): string | null {
  const parts = [product.form, product.dosage].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Ce que représente le stock de ce produit, en dirhams.
 *
 * Le calcul vit dans lib/stock/prix.ts, partagé avec la fiche produit :
 * deux écrans qui annoncent la valeur d'un même stock ne peuvent pas la
 * calculer chacun de leur côté.
 *
 * Le stock du **produit**, pas le lot qui périme : `nearestExpiryDate` est
 * une colonne du produit, saisie à la main, sans lot derrière elle — les
 * lots de cette base ne portent d'ailleurs presque aucune date. Prétendre
 * chiffrer « le lot qui périme » serait un chiffre juste en apparence.
 * L'interface dit donc « en stock », qui est ce qu'on sait.
 *
 * `null` quand le prix est inconnu ou nul : mieux vaut ne rien annoncer
 * qu'annoncer zéro dirham en jeu sur 120 boîtes.
 */
function valeurEnStock(product: ProductForAlerts): number | null {
  return valeurDuStock(product.price, product.quantityInStock);
}

export type LowStockAlert = {
  productId: string;
  productName: string;
  productPrecision: string | null;
  quantityInStock: number;
  lowStockThreshold: number;
};

export type ExpiryAlert = {
  productId: string;
  productName: string;
  productPrecision: string | null;
  nearestExpiryDate: Date;
  /** Negative when the product has already expired. */
  daysUntilExpiry: number;
  quantityInStock: number;
  /** Valeur du stock de ce produit, `null` si le prix est inconnu. */
  valeurEnStock: number | null;
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
      productPrecision: precision(product),
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
   * Ordre en deux temps :
   *
   *   1. ce qui est **déjà périmé**, le plus en retard d'abord — il faut
   *      le retirer du rayon aujourd'hui, quelle que soit sa valeur ;
   *   2. le reste par **valeur en jeu décroissante**.
   *
   * Trier tout par date mettait côte à côte deux produits « dans 8
   * jours » sans rien pour les départager, alors que l'un pèse parfois
   * quinze fois l'autre — et c'est la question qu'on se pose devant la
   * liste : par quoi commencer. À valeur inconnue ou égale, la date
   * tranche.
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
        productPrecision: precision(product),
        nearestExpiryDate,
        daysUntilExpiry: daysUntil(nearestExpiryDate, from),
        quantityInStock: product.quantityInStock,
        valeurEnStock: valeurEnStock(product),
      };
    })
    .filter((alert) => alert.daysUntilExpiry <= thresholdDays)
    .sort((a, b) => {
      const aPerime = a.daysUntilExpiry < 0;
      const bPerime = b.daysUntilExpiry < 0;
      if (aPerime !== bPerime) return aPerime ? -1 : 1;
      if (aPerime) return a.daysUntilExpiry - b.daysUntilExpiry;
      const ecart = (b.valeurEnStock ?? 0) - (a.valeurEnStock ?? 0);
      return ecart !== 0 ? ecart : a.daysUntilExpiry - b.daysUntilExpiry;
    });
}
