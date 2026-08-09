/**
 * Invoice number formatting. Pure on purpose: the *allocation* of the
 * next sequence is a database concern (see lib/server/invoices.ts, which
 * does it in one atomic statement), but turning an allocated sequence
 * into the printed number is plain string work and belongs here where it
 * can be tested directly.
 */

export const INVOICE_NUMBER_PREFIX = "FACT";
const SEQUENCE_PAD = 4;

/** `FACT-2026-0001`. Sequences beyond 9999 widen rather than wrap or truncate. */
export function formatInvoiceNumber(year: number, sequence: number): string {
  return `${INVOICE_NUMBER_PREFIX}-${year}-${String(sequence).padStart(SEQUENCE_PAD, "0")}`;
}

/** Parses a number back into its parts, or null when it isn't one of ours. */
export function parseInvoiceNumber(
  value: string,
): { year: number; sequence: number } | null {
  const match = /^FACT-(\d{4})-(\d{4,})$/.exec(value.trim());
  if (!match) return null;
  return { year: Number(match[1]), sequence: Number(match[2]) };
}
