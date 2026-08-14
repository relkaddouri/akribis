import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  affectsStock,
  canTransition,
  computeCreditTotal,
  SUPPLIER_CREDIT_MOTIFS,
} from "@/lib/suppliers/credits";

/**
 * In-memory Prisma fake for the credit-note lifecycle, same approach as
 * tests/orders/receive-order.test.ts.
 *
 * The point of this suite is the stock rule: goods leave on ISSUE, never on
 * SETTLEMENT. The fake therefore tracks every stock movement it is asked to
 * make, so a second decrement would show up as an extra row rather than
 * being quietly absorbed.
 */
const state = vi.hoisted(() => ({
  suppliers: [{ id: "supplier-1", pharmacyId: "pharmacy-1", name: "Pharma Distrib" }],
  orders: [{ id: "order-1", pharmacyId: "pharmacy-1" }],
  products: [] as Array<{ id: string; pharmacyId: string; name: string; quantityInStock: number }>,
  credits: [] as Array<{ id: string; numero: number; statut: string; montant: number }>,
  creditItems: [] as Array<{ creditId: string; productId: string; quantite: number }>,
  stockMovements: [] as Array<{ productId: string; type: string; quantity: number; reason: string }>,
  counters: new Map<string, number>(),
}));

class FakeDecimal {
  constructor(public value: number | string) {}
  valueOf() {
    return Number(this.value);
  }
}

function makeTx() {
  return {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join(" ");
      if (!/INSERT INTO document_counters/i.test(sql)) {
        throw new Error(`Unexpected raw SQL: ${sql}`);
      }
      const [pharmacyId, scope] = values as [string, string];
      const key = `${pharmacyId}:${scope}`;
      const next = (state.counters.get(key) ?? 0) + 1;
      state.counters.set(key, next);
      return Promise.resolve([{ last_sequence: next }]);
    },
    supplier: {
      findFirst: async ({ where }: { where: { id: string; pharmacyId: string } }) =>
        state.suppliers.find((s) => s.id === where.id && s.pharmacyId === where.pharmacyId) ?? null,
    },
    order: {
      findFirst: async ({ where }: { where: { id: string; pharmacyId: string } }) =>
        state.orders.find((o) => o.id === where.id && o.pharmacyId === where.pharmacyId) ?? null,
    },
    product: {
      findMany: async ({ where }: { where: { id: { in: string[] }; pharmacyId: string } }) =>
        state.products.filter(
          (p) => where.id.in.includes(p.id) && p.pharmacyId === where.pharmacyId,
        ),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; quantityInStock?: { gte: number } };
        data: { quantityInStock: { decrement: number } };
      }) => {
        const product = state.products.find((p) => p.id === where.id);
        // Mirrors the conditional UPDATE: no row matches when stock is short.
        if (!product) return { count: 0 };
        if (where.quantityInStock && product.quantityInStock < where.quantityInStock.gte) {
          return { count: 0 };
        }
        product.quantityInStock -= data.quantityInStock.decrement;
        return { count: 1 };
      },
    },
    stockMovement: {
      create: async ({
        data,
      }: {
        data: { productId: string; type: string; quantity: number; reason: string };
      }) => {
        state.stockMovements.push(data);
        return data;
      },
    },
    supplierCredit: {
      create: async ({
        data,
      }: {
        data: {
          numero: number;
          montant: FakeDecimal;
          items: { create: Array<{ productId: string; quantite: number }> };
        };
      }) => {
        const credit = {
          id: `credit-${state.credits.length + 1}`,
          numero: data.numero,
          statut: "EMIS",
          montant: Number(data.montant.valueOf()),
        };
        state.credits.push(credit);
        for (const item of data.items.create) {
          state.creditItems.push({ creditId: credit.id, ...item });
        }
        return { id: credit.id, numero: credit.numero };
      },
      findFirst: async ({ where }: { where: { id: string } }) =>
        state.credits.find((c) => c.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { statut: string } }) => {
        const credit = state.credits.find((c) => c.id === where.id);
        if (credit) credit.statut = data.statut;
        return credit;
      },
    },
  };
}

vi.mock("@/lib/db/generated/client", () => ({ Prisma: { Decimal: FakeDecimal } }));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    $transaction: async <T>(fn: (tx: ReturnType<typeof makeTx>) => Promise<T>): Promise<T> =>
      fn(makeTx()),
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

const { createSupplierCredit, settleSupplierCredit } = await import(
  "@/lib/server/supplier-credits"
);

beforeEach(() => {
  state.products = [
    { id: "p1", pharmacyId: "pharmacy-1", name: "Doliprane 500mg", quantityInStock: 40 },
    { id: "p2", pharmacyId: "pharmacy-1", name: "Augmentin 1g", quantityInStock: 10 },
  ];
  state.credits = [];
  state.creditItems = [];
  state.stockMovements = [];
  state.counters = new Map();
});

describe("stock leaves on issue, never on settlement", () => {
  it("decrements stock when the credit is issued", async () => {
    await createSupplierCredit({
      supplierId: "supplier-1",
      motif: "produit_endommage",
      lines: [{ productId: "p1", quantite: 5, unitPrice: 10 }],
    });

    expect(state.products[0]!.quantityInStock).toBe(35);
    expect(state.stockMovements).toHaveLength(1);
    expect(state.stockMovements[0]!.type).toBe("OUT");
  });

  it("does NOT decrement again when the credit is settled", async () => {
    const credit = await createSupplierCredit({
      supplierId: "supplier-1",
      motif: "produit_endommage",
      lines: [{ productId: "p1", quantite: 5, unitPrice: 10 }],
    });
    const stockAfterIssue = state.products[0]!.quantityInStock;
    const movementsAfterIssue = state.stockMovements.length;

    await settleSupplierCredit(credit.id, "especes");

    // The whole point: settlement is paperwork, not a second withdrawal.
    expect(state.products[0]!.quantityInStock).toBe(stockAfterIssue);
    expect(state.stockMovements).toHaveLength(movementsAfterIssue);
    expect(state.credits[0]!.statut).toBe("RECU");
  });

  it("decrements exactly once, whichever way the supplier compensates", async () => {
    // The rule has to hold for both settlement modes: neither a credit note
    // nor a cash refund is a second physical movement of goods.
    for (const mode of ["avoir_credit", "especes"] as const) {
      state.products = [
        { id: "p1", pharmacyId: "pharmacy-1", name: "Doliprane 500mg", quantityInStock: 40 },
      ];
      state.credits = [];
      state.stockMovements = [];
      state.counters = new Map();

      const credit = await createSupplierCredit({
        supplierId: "supplier-1",
        motif: "produit_endommage",
        lines: [{ productId: "p1", quantite: 6, unitPrice: 10 }],
      });

      expect(state.products[0]!.quantityInStock).toBe(34);
      expect(state.stockMovements).toHaveLength(1);

      await settleSupplierCredit(credit.id, mode);

      // Same stock, same single movement: settlement is paperwork only.
      expect(state.products[0]!.quantityInStock).toBe(34);
      expect(state.stockMovements).toHaveLength(1);
      expect(state.stockMovements[0]!.quantity).toBe(6);
    }
  });

  it("refuses to settle twice, so a double submit can't re-run anything", async () => {
    const credit = await createSupplierCredit({
      supplierId: "supplier-1",
      motif: "rappel_lot",
      lieRappelLot: true,
      lines: [{ productId: "p1", quantite: 2, unitPrice: 10 }],
    });
    await settleSupplierCredit(credit.id, "avoir_credit");

    await expect(settleSupplierCredit(credit.id, "avoir_credit")).rejects.toThrow(
      /déjà été réceptionné/,
    );
    expect(state.products[0]!.quantityInStock).toBe(38);
  });

  it("moves no stock for a price-only claim", async () => {
    // An `erreur_prix` claim is about money; nothing physically goes back.
    await createSupplierCredit({
      supplierId: "supplier-1",
      motif: "erreur_prix",
      lines: [{ productId: "p1", quantite: 5, unitPrice: 3 }],
    });

    expect(state.products[0]!.quantityInStock).toBe(40);
    expect(state.stockMovements).toHaveLength(0);
    expect(state.credits[0]!.montant).toBe(15);
  });

  it("rejects an issue that would drive stock below zero", async () => {
    await expect(
      createSupplierCredit({
        supplierId: "supplier-1",
        motif: "produit_perime",
        lines: [{ productId: "p2", quantite: 999, unitPrice: 1 }],
      }),
    ).rejects.toThrow(/Stock insuffisant/);
  });

  it("records the lot recall in the stock movement, for traceability", async () => {
    await createSupplierCredit({
      supplierId: "supplier-1",
      motif: "rappel_lot",
      lieRappelLot: true,
      lines: [{ productId: "p1", quantite: 3, unitPrice: 10 }],
    });

    expect(state.stockMovements[0]!.reason).toMatch(/rappel de lot/i);
  });

  it("gives each credit its own sequential number", async () => {
    const first = await createSupplierCredit({
      supplierId: "supplier-1",
      motif: "autre",
      lines: [{ productId: "p1", quantite: 1, unitPrice: 5 }],
    });
    const second = await createSupplierCredit({
      supplierId: "supplier-1",
      motif: "autre",
      lines: [{ productId: "p1", quantite: 1, unitPrice: 5 }],
    });

    expect(first.numero).toBe(1);
    expect(second.numero).toBe(2);
  });

  it("gives concurrent credits distinct numbers", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        createSupplierCredit({
          supplierId: "supplier-1",
          motif: "autre",
          lines: [{ productId: "p1", quantite: 1, unitPrice: 1 }],
        }),
      ),
    );

    expect(new Set(results.map((r) => r.numero)).size).toBe(20);
  });

  it("refuses an empty credit", async () => {
    await expect(
      createSupplierCredit({ supplierId: "supplier-1", motif: "autre", lines: [] }),
    ).rejects.toThrow(/au moins un produit/);
  });

  it("refuses a supplier from another pharmacy", async () => {
    await expect(
      createSupplierCredit({
        supplierId: "unknown",
        motif: "autre",
        lines: [{ productId: "p1", quantite: 1, unitPrice: 1 }],
      }),
    ).rejects.toThrow(/Fournisseur introuvable/);
  });
});

describe("credit rules", () => {
  it("treats only price-based motives as stock-neutral", () => {
    expect(affectsStock("erreur_prix")).toBe(false);
    expect(affectsStock("remise")).toBe(false);
    for (const motif of SUPPLIER_CREDIT_MOTIFS) {
      if (motif !== "erreur_prix" && motif !== "remise") {
        expect(affectsStock(motif)).toBe(true);
      }
    }
  });

  it("only allows emis → recu", () => {
    expect(canTransition("emis", "recu")).toBe(true);
    expect(canTransition("recu", "recu")).toBe(false);
    expect(canTransition("recu", "emis")).toBe(false);
    expect(canTransition("emis", "emis")).toBe(false);
  });

  it("totals the lines to the centime", () => {
    expect(
      computeCreditTotal([
        { productId: "a", quantite: 3, unitPrice: 3.33 },
        { productId: "b", quantite: 7, unitPrice: 1.11 },
      ]),
    ).toBe(17.76);
  });
});
