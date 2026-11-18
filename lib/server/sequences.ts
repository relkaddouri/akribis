import { Prisma } from "@/lib/db/generated/client";

/** Document families with their own independent numbering. */
/**
 * Les familles de documents à numérotation propre.
 *
 * Le Journal Z fait exception : son NNN repart à 1 chaque matin, donc sa
 * portée porte la date — `caisse_z:2026-08-22`. Une ligne de compteur par
 * jour, ce qui coûte moins qu'une table dédiée pour la même garantie
 * d'atomicité.
 */
export type SequenceScope =
  | "order"
  | "delivery"
  | "supplier_credit"
  | `caisse_z:${string}`;

/**
 * Allocates the next number for (pharmacy, scope) in ONE statement.
 *
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` is executed atomically by
 * Postgres and takes a row lock, so concurrent callers queue and each gets a
 * distinct value. Reading a MAX() and writing max+1 from application code
 * would interleave and hand two documents the same number — the
 * `@@unique([pharmacyId, numero])` index on each table would then reject one
 * of them, turning a race into a user-visible error.
 *
 * The sequence only ever moves forward: a document that fails to save after
 * its number was allocated leaves a gap rather than freeing the number for
 * reuse, which is what keeps the numbering auditable.
 *
 * Not a "use server" module on purpose — it takes a transaction client and
 * is called from inside other facades, never directly from a component.
 */
export async function allocateDocumentNumber(
  tx: Prisma.TransactionClient,
  pharmacyId: string,
  scope: SequenceScope,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ last_sequence: number }>>`
    INSERT INTO document_counters (pharmacy_id, scope, last_sequence)
    VALUES (${pharmacyId}, ${scope}, 1)
    ON CONFLICT (pharmacy_id, scope)
    DO UPDATE SET last_sequence = document_counters.last_sequence + 1
    RETURNING last_sequence
  `;

  const sequence = rows[0]?.last_sequence;
  if (typeof sequence !== "number") {
    throw new Error("Impossible d'attribuer un numéro de document.");
  }
  return sequence;
}
