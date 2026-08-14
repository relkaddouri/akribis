/**
 * Display formatting for the sequential order number already stored on
 * `orders.numero`. Pure string work, kept out of the PDF and the pages so
 * both render the same label.
 */
export const ORDER_NUMBER_PREFIX = "CMD";

/** `CMD-0001`. Sequences beyond 9999 widen rather than wrap or truncate. */
export function formatOrderNumber(numero: number): string {
  return `${ORDER_NUMBER_PREFIX}-${String(numero).padStart(4, "0")}`;
}

/** `BL-0001` — delivery notes carry their own independent sequence. */
export function formatDeliveryNumber(numero: number): string {
  return `BL-${String(numero).padStart(4, "0")}`;
}

/** `AV-0001` — supplier credits likewise. */
export function formatCreditNumber(numero: number): string {
  return `AV-${String(numero).padStart(4, "0")}`;
}
