import { beforeEach, describe, expect, it, vi } from "vitest";
import { allocateCredits } from "@/lib/suppliers/credit-allocation";
import { summariseSupplierActivity } from "@/lib/suppliers/activity";

/**
 * In-memory Prisma fake for the supplier detail sheet, same approach as
 * tests/orders/receive-order.test.ts.
 *
 * The invariant under test is agreement between two screens. The sheet shows
 * "solde crédit disponible" via an aggregate; the new-order screen lists the
 * individual credits it will let you spend. Those are different queries over
 * the same rows, so they can drift — and a sheet promising 800 MAD while the
 * order screen only offers 300 is a promise the pharmacy can't keep. The fake
 * therefore filters credits exactly as Postgres would, from one shared set of
 * rows, so any disagreement between the two paths surfaces here.
 */
const state = vi.hoisted(() => ({
  suppliers: [
    { id: "supplier-1", pharmacyId: "pharmacy-1", name: "Pharma Distrib" },
    { id: "supplier-2", pharmacyId: "pharmacy-1", name: "Autre Distrib" },
  ],
  orders: [] as Array<{
    id: string;
    pharmacyId: string;
    supplierId: string;
    numero: number;
    status: string;
    createdAt: Date;
    items: Array<{ quantity: number; unitPrice: number }>;
  }>,
  credits: [] as Array<{
    id: string;
    pharmacyId: string;
    supplierId: string;
    numero: number;
    statut: string;
    motif: string;
    modeCompensation: string | null;
    montant: number;
    montantRestant: number;
    dateEmission: Date;
    dateReception: Date | null;
    lieRappelLot: boolean;
  }>,
  deliveries: [] as Array<{
    id: string;
    pharmacyId: string;
    numero: number;
    dateReception: Date;
    order: { id: string; numero: number; supplierId: string };
    items: Array<{ quantiteRecue: number }>;
  }>,
}));

type CreditWhere = {
  pharmacyId: string;
  supplierId: string;
  statut?: string;
  modeCompensation?: string;
  montantRestant?: { gt: number };
};

/** Mirrors the SQL WHERE clause, so both call sites are filtered identically. */
function matchesCredit(credit: (typeof state.credits)[number], where: CreditWhere): boolean {
  if (credit.pharmacyId !== where.pharmacyId) return false;
  if (credit.supplierId !== where.supplierId) return false;
  if (where.statut !== undefined && credit.statut !== where.statut) return false;
  if (where.modeCompensation !== undefined && credit.modeCompensation !== where.modeCompensation) {
    return false;
  }
  if (where.montantRestant !== undefined && !(credit.montantRestant > where.montantRestant.gt)) {
    return false;
  }
  return true;
}

vi.mock("@/lib/db/client", () => ({
  prisma: {
    supplier: {
      findFirst: async ({ where }: { where: { id: string; pharmacyId: string } }) => {
        const supplier = state.suppliers.find(
          (s) => s.id === where.id && s.pharmacyId === where.pharmacyId,
        );
        if (!supplier) return null;
        return {
          ...supplier,
          phone: "0522000000",
          email: "contact@pharma-distrib.ma",
          createdAt: new Date("2025-01-15T09:00:00Z"),
          orders: state.orders
            .filter((order) => order.supplierId === supplier.id)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
          credits: state.credits
            .filter((credit) => credit.supplierId === supplier.id)
            .sort((a, b) => b.dateEmission.getTime() - a.dateEmission.getTime()),
        };
      },
    },
    delivery: {
      findMany: async ({
        where,
      }: {
        where: { pharmacyId: string; order: { supplierId: string } };
      }) =>
        state.deliveries.filter(
          (delivery) =>
            delivery.pharmacyId === where.pharmacyId &&
            delivery.order.supplierId === where.order.supplierId,
        ),
    },
    supplierCredit: {
      aggregate: async ({
        where,
        _sum,
      }: {
        where: CreditWhere;
        _sum: Partial<Record<"montant" | "montantRestant", true>>;
      }) => {
        // Honours whichever field is summed, so swapping `montantRestant`
        // for `montant` in the real query shows up as a wrong number here
        // rather than as an undefined the code would read as zero.
        const rows = state.credits.filter((credit) => matchesCredit(credit, where));
        const sums: Record<string, number> = {};
        for (const field of Object.keys(_sum) as Array<"montant" | "montantRestant">) {
          sums[field] = rows.reduce((sum, credit) => sum + credit[field], 0);
        }
        return { _sum: sums };
      },
      findMany: async ({ where }: { where: CreditWhere }) =>
        state.credits
          .filter((credit) => matchesCredit(credit, where))
          .sort((a, b) => a.dateEmission.getTime() - b.dateEmission.getTime()),
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

const { getSupplierDetail } = await import("@/lib/server/suppliers");
const { listUsableSupplierCredits } = await import("@/lib/server/supplier-credits");

let creditSeq = 0;

function credit(overrides: Partial<(typeof state.credits)[number]> = {}) {
  creditSeq += 1;
  return {
    id: `credit-${creditSeq}`,
    pharmacyId: "pharmacy-1",
    supplierId: "supplier-1",
    numero: creditSeq,
    statut: "RECU",
    motif: "PRODUIT_ENDOMMAGE",
    modeCompensation: "AVOIR_CREDIT",
    montant: 100,
    montantRestant: 100,
    dateEmission: new Date(`2026-0${Math.min(creditSeq, 9)}-01T10:00:00Z`),
    dateReception: new Date(`2026-0${Math.min(creditSeq, 9)}-05T10:00:00Z`),
    lieRappelLot: false,
    ...overrides,
  };
}

/**
 * A deliberately awkward set: every kind of credit that must NOT count
 * towards the balance sits alongside the ones that must.
 */
function seedMixedCredits() {
  state.credits = [
    // Counts in full.
    credit({ montant: 300, montantRestant: 300 }),
    // Partly spent on an earlier order: only the remainder counts.
    credit({ montant: 500, montantRestant: 120 }),
    // Fully consumed: worth nothing now, whatever its face value.
    credit({ montant: 400, montantRestant: 0 }),
    // Not confirmed by the supplier yet — a claim, not money.
    credit({ statut: "EMIS", modeCompensation: null, montant: 250, montantRestant: 250 }),
    // Refunded in cash: that money already came back.
    credit({ modeCompensation: "ESPECES", montant: 700, montantRestant: 700 }),
    // Another supplier's credit entirely.
    credit({ supplierId: "supplier-2", montant: 900, montantRestant: 900 }),
  ];
}

beforeEach(() => {
  creditSeq = 0;
  state.credits = [];
  state.orders = [];
  state.deliveries = [];
});

describe("the credit balance on the supplier sheet", () => {
  it("sums exactly the credits that are actually usable", async () => {
    seedMixedCredits();

    const detail = await getSupplierDetail("supplier-1");

    // 300 + 120. Everything else is excluded for a different reason.
    expect(detail!.creditBalance).toBe(420);
  });

  it("matches what the new-order screen offers for the same supplier", async () => {
    seedMixedCredits();

    const detail = await getSupplierDetail("supplier-1");
    const usable = await listUsableSupplierCredits("supplier-1");
    const offered = usable.reduce((sum, entry) => sum + entry.montantRestant, 0);

    // The sheet's headline figure and the sum the order screen can actually
    // apply must be the same number — a pharmacist reads one and expects the
    // other to be deducted.
    expect(detail!.creditBalance).toBe(offered);
  });

  it("matches the deduction an order large enough to absorb it would get", async () => {
    seedMixedCredits();

    const detail = await getSupplierDetail("supplier-1");
    const usable = await listUsableSupplierCredits("supplier-1");
    // An order far larger than the balance: every credit can be spent, so
    // the deduction is the whole balance and nothing is left over.
    const allocation = allocateCredits(10_000, usable);

    expect(allocation.deducted).toBe(detail!.creditBalance);
    expect(allocation.finalTotal).toBe(10_000 - detail!.creditBalance);
  });

  it("never deducts more than the balance on a small order", async () => {
    seedMixedCredits();

    const detail = await getSupplierDetail("supplier-1");
    const usable = await listUsableSupplierCredits("supplier-1");
    const allocation = allocateCredits(50, usable);

    // The order is smaller than the credit: the deduction stops at the
    // total and the rest of the balance survives for next time.
    expect(allocation.deducted).toBe(50);
    expect(allocation.deducted).toBeLessThanOrEqual(detail!.creditBalance);
    expect(allocation.finalTotal).toBe(0);
  });

  it("reads zero — not the face value — once every credit is consumed", async () => {
    state.credits = [
      credit({ montant: 300, montantRestant: 0 }),
      credit({ montant: 200, montantRestant: 0 }),
    ];

    const detail = await getSupplierDetail("supplier-1");
    const usable = await listUsableSupplierCredits("supplier-1");

    expect(detail!.creditBalance).toBe(0);
    expect(usable).toHaveLength(0);
  });

  it("keeps each supplier's balance to itself", async () => {
    seedMixedCredits();

    const other = await getSupplierDetail("supplier-2");

    expect(other!.creditBalance).toBe(900);
  });

  it("returns null for a supplier from another pharmacy", async () => {
    expect(await getSupplierDetail("unknown")).toBeNull();
  });

  it("still lists an unusable credit, marked for what it is", async () => {
    seedMixedCredits();

    const detail = await getSupplierDetail("supplier-1");

    // The balance excludes them, but the Avoirs table must still show the
    // cash refund and the pending claim — they happened.
    expect(detail!.credits).toHaveLength(5);
    expect(detail!.credits.some((c) => c.modeCompensation === "especes")).toBe(true);
    expect(detail!.credits.some((c) => c.statut === "emis")).toBe(true);
  });
});

describe("the sheet's order and delivery history", () => {
  it("totals each order from its own lines", async () => {
    state.orders = [
      {
        id: "order-1",
        pharmacyId: "pharmacy-1",
        supplierId: "supplier-1",
        numero: 1,
        status: "ENVOYEE",
        createdAt: new Date("2026-08-01T10:00:00Z"),
        items: [
          { quantity: 3, unitPrice: 33.33 },
          { quantity: 7, unitPrice: 1.11 },
        ],
      },
    ];

    const detail = await getSupplierDetail("supplier-1");

    // 99.99 + 7.77, rounded once at the centime.
    expect(detail!.orders[0]!.totalAmount).toBe(107.76);
  });

  it("reports both the number of references and the units received", async () => {
    state.deliveries = [
      {
        id: "delivery-1",
        pharmacyId: "pharmacy-1",
        numero: 1,
        dateReception: new Date("2026-08-05T10:00:00Z"),
        order: { id: "order-1", numero: 1, supplierId: "supplier-1" },
        items: [{ quantiteRecue: 12 }, { quantiteRecue: 3 }],
      },
    ];

    const detail = await getSupplierDetail("supplier-1");

    // Two references, fifteen units — a shipment of 15 boxes of one product
    // is not the same event as 15 different products arriving.
    expect(detail!.deliveries[0]!.productCount).toBe(2);
    expect(detail!.deliveries[0]!.unitCount).toBe(15);
    expect(detail!.deliveries[0]!.orderId).toBe("order-1");
  });

  it("shows nothing from another supplier's history", async () => {
    state.orders = [
      {
        id: "order-2",
        pharmacyId: "pharmacy-1",
        supplierId: "supplier-2",
        numero: 2,
        status: "ENVOYEE",
        createdAt: new Date("2026-08-01T10:00:00Z"),
        items: [{ quantity: 1, unitPrice: 10 }],
      },
    ];
    state.deliveries = [
      {
        id: "delivery-2",
        pharmacyId: "pharmacy-1",
        numero: 2,
        dateReception: new Date("2026-08-05T10:00:00Z"),
        order: { id: "order-2", numero: 2, supplierId: "supplier-2" },
        items: [{ quantiteRecue: 1 }],
      },
    ];

    const detail = await getSupplierDetail("supplier-1");

    expect(detail!.orders).toHaveLength(0);
    expect(detail!.deliveries).toHaveLength(0);
  });
});

describe("the supplier's headline figures", () => {
  const now = new Date("2026-08-11T12:00:00Z");

  it("counts only the trailing 12 months of orders", () => {
    const summary = summariseSupplierActivity(
      [
        { createdAt: new Date("2026-08-01T10:00:00Z"), status: "RECUE", totalAmount: 1000 },
        { createdAt: new Date("2025-09-01T10:00:00Z"), status: "RECUE", totalAmount: 500 },
        // 13 months back: outside the window.
        { createdAt: new Date("2025-07-01T10:00:00Z"), status: "RECUE", totalAmount: 9999 },
      ],
      [],
      now,
    );

    expect(summary.orderedLast12Months).toBe(1500);
  });

  it("treats an order as in progress until everything has arrived", () => {
    const summary = summariseSupplierActivity(
      [
        { createdAt: now, status: "ENVOYEE", totalAmount: 100 },
        { createdAt: now, status: "PARTIELLEMENT_RECUE", totalAmount: 100 },
        { createdAt: now, status: "BROUILLON", totalAmount: 100 },
        { createdAt: now, status: "RECUE", totalAmount: 100 },
        { createdAt: now, status: "CLOTUREE", totalAmount: 100 },
      ],
      [],
      now,
    );

    expect(summary.ordersInProgress).toBe(3);
  });

  it("counts only claims the supplier has not answered", () => {
    const summary = summariseSupplierActivity(
      [],
      [{ statut: "emis" }, { statut: "emis" }, { statut: "recu" }],
      now,
    );

    expect(summary.creditsAwaitingConfirmation).toBe(2);
  });
});
