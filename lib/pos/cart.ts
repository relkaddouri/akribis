/**
 * Pure cart logic for the POS module: no framework, no data layer. Used
 * both for instant client-side feedback (capping a line at the product's
 * known stock so the cashier can't even try to oversell) and unit tested
 * directly. The server transaction in lib/offline/sales.ts is still the
 * authority — this is UX, not the security boundary.
 */

export type CartLine = {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  /** Stock snapshot at the time the product was added/looked up. */
  availableStock: number;
  /**
   * De quoi partager la ligne avec un organisme de tiers payant.
   *
   * Optionnels : une ligne construite depuis un produit mis en cache avant
   * le tiers payant ne les porte pas. Un statut inconnu ne donne droit à
   * rien — même règle qu'une base absente, et le bon défaut : mieux vaut
   * ne rien réclamer que réclamer à tort.
   */
  remboursable?: boolean;
  baseRemboursement?: number | null;
};

export type CartProduct = {
  id: string;
  name: string;
  price: number;
  quantityInStock: number;
  /** Optionnels : un produit du cache d'avant le tiers payant ne les porte
   *  pas, et une ligne sans base ne donne droit à aucun remboursement. */
  remboursable?: boolean;
  baseRemboursement?: number | null;
};

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getLineTotal(line: Pick<CartLine, "unitPrice" | "quantity">): number {
  return round2(line.unitPrice * line.quantity);
}

export function computeCartTotal(lines: CartLine[]): number {
  return round2(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0));
}

export function getCartItemCount(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

/**
 * Adds `requestedQuantity` of `product` to the cart, or increments the
 * existing line for that product. Always clamps to the product's known
 * stock (never below 1, never above `quantityInStock`) and reports
 * whether the request had to be capped, so the UI can warn the cashier.
 */
export function addToCart(
  lines: CartLine[],
  product: CartProduct,
  requestedQuantity = 1,
): { lines: CartLine[]; capped: boolean } {
  const existing = lines.find((line) => line.productId === product.id);
  const currentQuantity = existing?.quantity ?? 0;
  const desiredQuantity = currentQuantity + requestedQuantity;
  const clampedQuantity = Math.min(desiredQuantity, product.quantityInStock);
  const capped = clampedQuantity < desiredQuantity || product.quantityInStock <= 0;

  if (clampedQuantity <= 0) {
    return { lines, capped: true };
  }

  if (existing) {
    return {
      lines: lines.map((line) =>
        line.productId === product.id
          ? { ...line, quantity: clampedQuantity, availableStock: product.quantityInStock }
          : line,
      ),
      capped,
    };
  }

  return {
    lines: [
      ...lines,
      {
        productId: product.id,
        productName: product.name,
        unitPrice: product.price,
        quantity: clampedQuantity,
        availableStock: product.quantityInStock,
        // Sans cette recopie, toute ligne est « non remboursable » et le
        // tiers payant devient inatteignable. Les champs étant optionnels
        // sur CartProduct, leur oubli ne fait pas broncher `tsc`.
        remboursable: product.remboursable ?? false,
        baseRemboursement: product.baseRemboursement ?? null,
      },
    ],
    capped,
  };
}

export function removeFromCart(lines: CartLine[], productId: string): CartLine[] {
  return lines.filter((line) => line.productId !== productId);
}

/** Clamps to [1, availableStock]; quantities below 1 are not allowed here — remove the line instead. */
export function setCartLineQuantity(
  lines: CartLine[],
  productId: string,
  quantity: number,
): CartLine[] {
  return lines.map((line) =>
    line.productId === productId
      ? { ...line, quantity: Math.max(1, Math.min(quantity, line.availableStock)) }
      : line,
  );
}
