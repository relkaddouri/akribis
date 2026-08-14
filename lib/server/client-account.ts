"use server";

/**
 * The client account: balance movements, loyalty points and the reads the
 * client sheet needs. Every read and write is scoped to the caller's own
 * pharmacy via requireUser().
 *
 * THE INVARIANT: `Client.solde` must always equal the sum of that client's
 * `ClientTransaction.montant`. It holds because there is exactly one
 * writer — `recordClientTransaction` below — and it inserts the row and
 * moves the balance inside the same database transaction, using the same
 * signed amount for both. Nothing else in the codebase touches `solde`.
 */

import { revalidatePath } from "next/cache";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import {
  computeBalance,
  type ClientTransactionTypeValue,
} from "@/lib/clients/account";

/** Prisma enum members are UPPERCASE; the UI and DB values are lowercase. */
function toDbType(value: ClientTransactionTypeValue) {
  return value.toUpperCase() as "VENTE" | "PAIEMENT_PARTIEL" | "AVOIR_RECU" | "AJUSTEMENT";
}

function toUiType(value: string): ClientTransactionTypeValue {
  return value.toLowerCase() as ClientTransactionTypeValue;
}

export type RecordTransactionInput = {
  clientId: string;
  type: ClientTransactionTypeValue;
  /** SIGNED: negative increases the debt, positive reduces it. */
  montant: number;
  saleId?: string | null;
  description?: string | null;
};

/**
 * The single writer of `Client.solde`.
 *
 * Takes an existing transaction client so callers already inside a
 * transaction (a credit sale, for instance) stay atomic: the sale, its
 * stock movements, the balance row and the balance itself either all land
 * or none do. `increment` is used rather than read-modify-write so two
 * concurrent movements can't overwrite each other's result.
 */
export async function recordClientTransaction(
  tx: Prisma.TransactionClient,
  pharmacyId: string,
  input: RecordTransactionInput,
): Promise<void> {
  if (input.montant === 0) return;

  await tx.clientTransaction.create({
    data: {
      pharmacyId,
      clientId: input.clientId,
      type: toDbType(input.type),
      montant: new Prisma.Decimal(input.montant),
      saleId: input.saleId ?? null,
      description: input.description ?? null,
    },
  });

  await tx.client.update({
    where: { id: input.clientId },
    data: { solde: { increment: new Prisma.Decimal(input.montant) } },
  });
}

/** Adds loyalty points, in the same transaction as the sale that earned them. */
export async function addLoyaltyPoints(
  tx: Prisma.TransactionClient,
  clientId: string,
  points: number,
): Promise<void> {
  if (points <= 0) return;
  await tx.client.update({
    where: { id: clientId },
    data: { pointsFidelite: { increment: points } },
  });
}

export type ClientAccountTransaction = {
  id: string;
  type: ClientTransactionTypeValue;
  montant: number;
  date: Date;
  saleId: string | null;
  description: string | null;
};

export type ClientAccount = {
  solde: number;
  pointsFidelite: number;
  transactions: ClientAccountTransaction[];
};

export async function getClientAccount(clientId: string): Promise<ClientAccount | null> {
  const user = await requireUser();

  const client = await prisma.client.findFirst({
    where: { id: clientId, pharmacyId: user.pharmacyId },
    select: {
      solde: true,
      pointsFidelite: true,
      transactions: {
        orderBy: { date: "desc" },
        select: { id: true, type: true, montant: true, date: true, saleId: true, description: true },
      },
    },
  });
  if (!client) return null;

  return {
    solde: Number(client.solde),
    pointsFidelite: client.pointsFidelite,
    transactions: client.transactions.map((entry) => ({
      id: entry.id,
      type: toUiType(entry.type),
      montant: Number(entry.montant),
      date: entry.date,
      saleId: entry.saleId,
      description: entry.description,
    })),
  };
}

/**
 * Records money received from (or handed back to) a client.
 *
 * `amount` is signed by intent: positive settles a debt, negative pays a
 * credit balance back out. Zero is rejected rather than silently writing a
 * no-op row into the history.
 */
export async function registerClientPayment(input: {
  clientId: string;
  amount: number;
  description?: string;
}): Promise<{ solde: number }> {
  const user = await requireUser();
  if (!Number.isFinite(input.amount) || input.amount === 0) {
    throw new Error("Le montant du paiement doit être différent de zéro.");
  }

  const solde = await prisma.$transaction(async (tx) => {
    const client = await tx.client.findFirst({
      where: { id: input.clientId, pharmacyId: user.pharmacyId },
      select: { id: true },
    });
    if (!client) throw new Error("Client introuvable.");

    await recordClientTransaction(tx, user.pharmacyId, {
      clientId: client.id,
      type: "paiement_partiel",
      montant: input.amount,
      description: input.description?.trim() || null,
    });

    const updated = await tx.client.findUniqueOrThrow({
      where: { id: client.id },
      select: { solde: true },
    });
    return Number(updated.solde);
  });

  revalidatePath(`/dashboard/clients/${input.clientId}`);
  return { solde };
}

/**
 * Recomputes a client's balance from their transaction history and reports
 * any divergence. Nothing should ever diverge — this exists so the
 * invariant can be asserted rather than assumed.
 */
export async function auditClientBalance(clientId: string): Promise<{
  stored: number;
  computed: number;
  matches: boolean;
}> {
  const user = await requireUser();

  const client = await prisma.client.findFirst({
    where: { id: clientId, pharmacyId: user.pharmacyId },
    select: { solde: true, transactions: { select: { montant: true } } },
  });
  if (!client) throw new Error("Client introuvable.");

  const stored = Number(client.solde);
  const computed = computeBalance(client.transactions.map((t) => ({ montant: Number(t.montant) })));

  return { stored, computed, matches: stored === computed };
}
