/**
 * Pure logic for the client account: balance arithmetic and loyalty
 * points. Framework- and data-layer-agnostic, same split as
 * lib/stock/alerts.ts, so the money rules can be tested without a
 * database.
 *
 * SIGN CONVENTION, used everywhere (Client.solde and
 * ClientTransaction.montant alike):
 *   negative → the client owes the pharmacy (a credit sale)
 *   positive → the pharmacy owes the client (an overpayment or a credit note)
 *
 * Keeping one signed column, rather than a type-dependent sign, is what
 * makes the balance a plain sum and the invariant checkable.
 */

import { round2 } from "@/lib/pos/cart";

export const CLIENT_TRANSACTION_TYPES = [
  "vente",
  "paiement_partiel",
  "avoir_recu",
  "ajustement",
] as const;
export type ClientTransactionTypeValue = (typeof CLIENT_TRANSACTION_TYPES)[number];

export const CLIENT_TRANSACTION_LABELS: Record<ClientTransactionTypeValue, string> = {
  vente: "Vente à crédit",
  paiement_partiel: "Paiement reçu",
  avoir_recu: "Avoir accordé",
  ajustement: "Ajustement",
};

export type ClientTransactionEntry = {
  montant: number;
};

/**
 * The balance a client's history adds up to. This is the definition the
 * stored `Client.solde` must always match.
 */
export function computeBalance(transactions: ClientTransactionEntry[]): number {
  return round2(transactions.reduce((sum, entry) => sum + entry.montant, 0));
}

export type BalanceState = "debt" | "credit" | "settled";

export function getBalanceState(balance: number): BalanceState {
  if (balance < 0) return "debt";
  if (balance > 0) return "credit";
  return "settled";
}

/** Amount owed, as a positive number — what the pharmacist actually asks for. */
export function amountOwed(balance: number): number {
  return balance < 0 ? round2(-balance) : 0;
}

/**
 * Signed movement for a credit sale: the client leaves owing `total`, so
 * the balance goes down.
 */
export function creditSaleMovement(total: number): number {
  return round2(-Math.abs(total));
}

/**
 * Signed movement for a payment received. A positive `amount` reduces the
 * debt; the caller decides the direction by sign, so handing money *back*
 * to a client with a credit balance is the same operation with a negative
 * amount.
 */
export function paymentMovement(amount: number): number {
  return round2(amount);
}

export const DEFAULT_LOYALTY_RATE = 1;

/**
 * Points earned on a sale: one point per `rate` dirhams spent, rounded
 * down so a partially-earned point isn't credited.
 *
 * A rate of zero (or negative) would mean "infinite points per dirham";
 * it's treated as "loyalty disabled" rather than allowed to divide by zero.
 */
export function computeLoyaltyPoints(total: number, rate: number): number {
  if (rate <= 0) return 0;
  if (total <= 0) return 0;
  return Math.floor(total / rate);
}
