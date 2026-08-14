import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  amountOwed,
  computeBalance,
  computeLoyaltyPoints,
  creditSaleMovement,
  getBalanceState,
  paymentMovement,
} from "@/lib/clients/account";

/**
 * In-memory Prisma fake for the client account, same approach as
 * tests/orders/receive-order.test.ts: the real server facade runs, only
 * Postgres is swapped out.
 *
 * The fake models `solde` as a genuinely separate column updated by
 * `increment` — it never derives the balance from the transaction rows.
 * That's deliberate: if the production code ever stopped writing both
 * sides together, the invariant assertions below would catch the drift
 * instead of a helpful fake papering over it.
 */
const state = vi.hoisted(() => ({
  clients: [] as Array<{ id: string; pharmacyId: string; solde: number; pointsFidelite: number }>,
  transactions: [] as Array<{
    id: string;
    clientId: string;
    type: string;
    montant: number;
    saleId: string | null;
    description: string | null;
    date: Date;
  }>,
}));

/** Mirrors Prisma.Decimal closely enough for the arithmetic under test. */
class FakeDecimal {
  value: number;
  constructor(value: number | string) {
    this.value = Number(value);
  }
  toString() {
    return String(this.value);
  }
  valueOf() {
    return this.value;
  }
}

function asNumber(value: unknown): number {
  return value instanceof FakeDecimal ? value.value : Number(value);
}

function makeTx() {
  return {
    clientTransaction: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.transactions.push({
          id: `t${state.transactions.length + 1}`,
          clientId: String(data.clientId),
          type: String(data.type),
          montant: asNumber(data.montant),
          saleId: (data.saleId as string | null) ?? null,
          description: (data.description as string | null) ?? null,
          date: new Date(),
        });
      },
    },
    client: {
      findFirst: async ({ where }: { where: { id: string; pharmacyId: string } }) =>
        state.clients.find((c) => c.id === where.id && c.pharmacyId === where.pharmacyId) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const found = state.clients.find((c) => c.id === where.id);
        if (!found) throw new Error("not found");
        return { solde: new FakeDecimal(found.solde), pointsFidelite: found.pointsFidelite };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { solde?: { increment: unknown }; pointsFidelite?: { increment: number } };
      }) => {
        const found = state.clients.find((c) => c.id === where.id);
        if (!found) throw new Error("not found");
        if (data.solde) {
          // Rounded like Decimal(12,2) would, so float noise can't be
          // mistaken for a real divergence.
          found.solde = Math.round((found.solde + asNumber(data.solde.increment)) * 100) / 100;
        }
        if (data.pointsFidelite) found.pointsFidelite += data.pointsFidelite.increment;
        return found;
      },
    },
  };
}

vi.mock("@/lib/db/generated/client", () => ({
  Prisma: { Decimal: FakeDecimal },
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    $transaction: async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx()),
    client: {
      findFirst: async ({ where }: { where: { id: string; pharmacyId: string } }) => {
        const found = state.clients.find(
          (c) => c.id === where.id && c.pharmacyId === where.pharmacyId,
        );
        if (!found) return null;
        return {
          solde: new FakeDecimal(found.solde),
          pointsFidelite: found.pointsFidelite,
          transactions: state.transactions
            .filter((t) => t.clientId === found.id)
            .map((t) => ({ ...t, montant: new FakeDecimal(t.montant) })),
        };
      },
    },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({
    id: "user-1",
    email: "owner@akribis.test",
    name: "Titulaire",
    role: "owner",
    pharmacyId: "pharmacy-1",
  })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { auditClientBalance, recordClientTransaction, registerClientPayment, addLoyaltyPoints } =
  await import("@/lib/server/client-account");

/** The invariant the whole module exists to protect. */
async function expectBalanceMatchesHistory(clientId: string) {
  const audit = await auditClientBalance(clientId);
  expect(audit.matches).toBe(true);
  expect(audit.stored).toBe(audit.computed);
  return audit;
}

beforeEach(() => {
  state.clients = [{ id: "c1", pharmacyId: "pharmacy-1", solde: 0, pointsFidelite: 0 }];
  state.transactions = [];
});

describe("balance stays consistent with the transaction history", () => {
  it("matches after a single credit sale", async () => {
    await prismaTx((tx) =>
      recordClientTransaction(tx, "pharmacy-1", {
        clientId: "c1",
        type: "vente",
        montant: creditSaleMovement(250),
        saleId: "sale-1",
      }),
    );

    const audit = await expectBalanceMatchesHistory("c1");
    expect(audit.stored).toBe(-250);
  });

  it("matches after a partial payment reduces the debt", async () => {
    await prismaTx((tx) =>
      recordClientTransaction(tx, "pharmacy-1", {
        clientId: "c1",
        type: "vente",
        montant: creditSaleMovement(250),
      }),
    );
    await registerClientPayment({ clientId: "c1", amount: 100 });

    const audit = await expectBalanceMatchesHistory("c1");
    expect(audit.stored).toBe(-150);
  });

  it("matches after a long mixed history", async () => {
    const movements: Array<[Parameters<typeof recordClientTransaction>[2]["type"], number]> = [
      ["vente", creditSaleMovement(120.55)],
      ["paiement_partiel", paymentMovement(50)],
      ["vente", creditSaleMovement(33.33)],
      ["avoir_recu", 12.4],
      ["paiement_partiel", paymentMovement(20.15)],
      ["ajustement", -5],
      ["vente", creditSaleMovement(7.77)],
    ];

    for (const [type, montant] of movements) {
      await prismaTx((tx) =>
        recordClientTransaction(tx, "pharmacy-1", { clientId: "c1", type, montant }),
      );
    }

    const audit = await expectBalanceMatchesHistory("c1");
    expect(state.transactions).toHaveLength(movements.length);
    // Independently computed from the same list, to catch a fake that
    // simply echoed the stored value back.
    expect(audit.computed).toBe(computeBalance(movements.map(([, montant]) => ({ montant }))));
  });

  it("matches when a client is overpaid into a credit balance", async () => {
    await prismaTx((tx) =>
      recordClientTransaction(tx, "pharmacy-1", {
        clientId: "c1",
        type: "vente",
        montant: creditSaleMovement(80),
      }),
    );
    await registerClientPayment({ clientId: "c1", amount: 200 });

    const audit = await expectBalanceMatchesHistory("c1");
    expect(audit.stored).toBe(120);
    expect(getBalanceState(audit.stored)).toBe("credit");
  });

  it("matches after concurrent movements — no lost update", async () => {
    // Ten payments submitted at once. `increment` is what makes this safe;
    // a read-modify-write in application code would drop some of them and
    // the balance would no longer equal the history.
    await Promise.all(
      Array.from({ length: 10 }, () => registerClientPayment({ clientId: "c1", amount: 10 })),
    );

    const audit = await expectBalanceMatchesHistory("c1");
    expect(state.transactions).toHaveLength(10);
    expect(audit.stored).toBe(100);
  });

  it("survives centime-level amounts without drifting", async () => {
    for (let i = 0; i < 30; i++) {
      await prismaTx((tx) =>
        recordClientTransaction(tx, "pharmacy-1", {
          clientId: "c1",
          type: "vente",
          montant: creditSaleMovement(0.1),
        }),
      );
    }

    const audit = await expectBalanceMatchesHistory("c1");
    expect(audit.stored).toBe(-3);
  });

  it("writes no history row and moves nothing for a zero amount", async () => {
    await prismaTx((tx) =>
      recordClientTransaction(tx, "pharmacy-1", { clientId: "c1", type: "ajustement", montant: 0 }),
    );

    expect(state.transactions).toHaveLength(0);
    await expectBalanceMatchesHistory("c1");
  });

  it("detects a divergence rather than hiding it", async () => {
    // Proves the audit has teeth: tamper with the stored balance directly,
    // the way a second writer bypassing recordClientTransaction would.
    await prismaTx((tx) =>
      recordClientTransaction(tx, "pharmacy-1", {
        clientId: "c1",
        type: "vente",
        montant: creditSaleMovement(50),
      }),
    );
    state.clients[0]!.solde = -40;

    const audit = await auditClientBalance("c1");
    expect(audit.matches).toBe(false);
    expect(audit.stored).toBe(-40);
    expect(audit.computed).toBe(-50);
  });
});

describe("registerClientPayment", () => {
  it("rejects a zero payment instead of writing a no-op row", async () => {
    await expect(registerClientPayment({ clientId: "c1", amount: 0 })).rejects.toThrow(
      /différent de zéro/,
    );
    expect(state.transactions).toHaveLength(0);
  });

  it("refuses a client from another pharmacy", async () => {
    state.clients.push({ id: "other", pharmacyId: "pharmacy-2", solde: 0, pointsFidelite: 0 });

    await expect(registerClientPayment({ clientId: "other", amount: 50 })).rejects.toThrow(
      /introuvable/,
    );
  });
});

describe("loyalty points", () => {
  it("awards one point per rate unit spent, rounding down", () => {
    expect(computeLoyaltyPoints(250, 1)).toBe(250);
    expect(computeLoyaltyPoints(250, 10)).toBe(25);
    expect(computeLoyaltyPoints(99, 10)).toBe(9);
  });

  it("treats a zero or negative rate as loyalty disabled, not a division by zero", () => {
    expect(computeLoyaltyPoints(250, 0)).toBe(0);
    expect(computeLoyaltyPoints(250, -5)).toBe(0);
  });

  it("awards nothing on an empty or negative total", () => {
    expect(computeLoyaltyPoints(0, 1)).toBe(0);
    expect(computeLoyaltyPoints(-10, 1)).toBe(0);
  });

  it("accumulates on the client without touching the balance", async () => {
    await prismaTx((tx) => addLoyaltyPoints(tx, "c1", 25));
    await prismaTx((tx) => addLoyaltyPoints(tx, "c1", 10));

    expect(state.clients[0]!.pointsFidelite).toBe(35);
    await expectBalanceMatchesHistory("c1");
  });
});

describe("balance presentation helpers", () => {
  it("classifies debt, credit and a settled account", () => {
    expect(getBalanceState(-10)).toBe("debt");
    expect(getBalanceState(10)).toBe("credit");
    expect(getBalanceState(0)).toBe("settled");
  });

  it("reports the amount owed as a positive figure", () => {
    expect(amountOwed(-150.5)).toBe(150.5);
    expect(amountOwed(20)).toBe(0);
  });
});

/** The transaction-client type the facade expects; the fake stands in for it. */
type FacadeTx = Parameters<typeof recordClientTransaction>[0];

/**
 * Runs `fn` inside the same fake transaction the facade would use. The
 * single cast lives here rather than at every call site: the fake
 * implements only the handful of models these tests touch, not the whole
 * generated TransactionClient surface.
 */
async function prismaTx(fn: (tx: FacadeTx) => Promise<void>) {
  const { prisma } = await import("@/lib/db/client");
  return (
    prisma as unknown as {
      $transaction: (cb: (tx: FacadeTx) => Promise<void>) => Promise<void>;
    }
  ).$transaction((tx) => fn(tx));
}
