/**
 * Pure logic for sale returns — validation, refund maths and the derived
 * sale status. Framework- and data-layer-agnostic, same split as
 * lib/stock/alerts.ts, so the rules that decide how much money goes back
 * to a client can be tested without a database.
 */

import { roundCentimes } from "@/lib/invoices/totals";

export const SALE_RETURN_STATUSES = ["none", "partial", "full"] as const;
export type SaleReturnStatusValue = (typeof SALE_RETURN_STATUSES)[number];

export const SALE_RETURN_STATUS_LABELS: Record<SaleReturnStatusValue, string> = {
  none: "Normale",
  partial: "Retour partiel",
  full: "Retour total",
};

/** A sale line, as far as return rules are concerned. */
export type ReturnableLine = {
  saleItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  /** Cumulative quantity already returned across previous returns. */
  returnedQuantity: number;
  unitPrice: number;
};

/** What the operator asks to return for one line. */
export type ReturnLineInput = {
  saleItemId: string;
  quantity: number;
  /** false = goods destroyed instead of put back on the shelf. */
  restock: boolean;
};

export function remainingReturnable(line: ReturnableLine): number {
  return Math.max(0, line.quantity - line.returnedQuantity);
}

/**
 * Status of a sale once `lines` reflect all returns recorded so far.
 *
 * "full" means every unit sold has come back — not merely that some line
 * is fully returned, which is why this compares totals rather than
 * checking any single line.
 */
export function computeReturnStatus(
  lines: Array<Pick<ReturnableLine, "quantity" | "returnedQuantity">>,
): SaleReturnStatusValue {
  const sold = lines.reduce((sum, line) => sum + line.quantity, 0);
  const returned = lines.reduce((sum, line) => sum + line.returnedQuantity, 0);

  if (returned <= 0) return "none";
  if (sold > 0 && returned >= sold) return "full";
  return "partial";
}

export type ReturnValidationError =
  | { code: "empty"; message: string }
  | { code: "unknown_line"; message: string; saleItemId: string }
  | { code: "exceeds_remaining"; message: string; saleItemId: string };

export type ValidatedReturnLine = ReturnLineInput & {
  productId: string;
  productName: string;
  unitPrice: number;
  refundAmount: number;
};

export type ReturnValidation =
  | { ok: true; lines: ValidatedReturnLine[]; totalRefund: number }
  | { ok: false; error: ReturnValidationError };

/**
 * Checks a return request against what's actually still returnable and
 * computes the refund.
 *
 * Refunds are rounded per line and summed from the rounded values, for
 * the same reason invoices are: the amounts shown next to each product
 * have to add up to the total handed back.
 */
export function validateReturn(
  saleLines: ReturnableLine[],
  inputs: ReturnLineInput[],
): ReturnValidation {
  const byId = new Map(saleLines.map((line) => [line.saleItemId, line]));
  const requested = inputs.filter((input) => input.quantity > 0);

  if (requested.length === 0) {
    return {
      ok: false,
      error: { code: "empty", message: "Indiquez au moins une quantité à retourner." },
    };
  }

  const lines: ValidatedReturnLine[] = [];
  for (const input of requested) {
    const line = byId.get(input.saleItemId);
    if (!line) {
      return {
        ok: false,
        error: {
          code: "unknown_line",
          message: "Une ligne sélectionnée n'appartient pas à cette vente.",
          saleItemId: input.saleItemId,
        },
      };
    }

    const remaining = remainingReturnable(line);
    if (input.quantity > remaining) {
      return {
        ok: false,
        error: {
          code: "exceeds_remaining",
          message: `Quantité trop élevée pour « ${line.productName} » : ${remaining} unité(s) encore retournable(s).`,
          saleItemId: input.saleItemId,
        },
      };
    }

    lines.push({
      ...input,
      productId: line.productId,
      productName: line.productName,
      unitPrice: line.unitPrice,
      refundAmount: roundCentimes(line.unitPrice * input.quantity),
    });
  }

  const totalRefund = roundCentimes(lines.reduce((sum, line) => sum + line.refundAmount, 0));
  return { ok: true, lines, totalRefund };
}

/** `VTE-1A2B3C4D` — a stable, readable handle derived from the sale's uuid. */
export function formatSaleReference(saleId: string): string {
  return `VTE-${saleId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/**
 * Extracts the id fragment a user typed, whether they pasted the full
 * reference or just its digits, so search matches either form.
 */
export function saleReferenceToIdFragment(search: string): string {
  return search.trim().replace(/^vte-?/i, "").replace(/-/g, "").toLowerCase();
}
