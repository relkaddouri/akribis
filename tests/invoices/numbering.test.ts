import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatInvoiceNumber, parseInvoiceNumber } from "@/lib/invoices/numbering";

/**
 * In-memory Prisma fake for the numbering path.
 *
 * The point of this suite is the concurrency guarantee, so the fake is
 * built to *expose* races rather than hide them: `$queryRaw` applies the
 * counter increment synchronously (faithful to Postgres executing
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` as one atomic,
 * row-locked statement), while every other call yields to the event loop.
 * An implementation that read a MAX() and wrote back across two awaits
 * would interleave on those yields and collide — see the last test, which
 * demonstrates the fake really does catch that.
 */
const state = vi.hoisted(() => ({
  journal: [] as Record<string, unknown>[],
  counters: new Map<string, number>(),
  invoices: [] as Array<{ id: string; number: string; year: number; sequence: number; status: string }>,
  pharmacy: { name: "Pharmacie Test", address: "12 rue X", phone: "0600", ice: "ICE1" },
  sales: [] as Array<{
    id: string;
    pharmacyId: string;
    clientId: string | null;
    invoiceId: string | null;
    client: { id: string; name: string } | null;
    items: Array<{
      quantity: number;
      unitPrice: number;
      productId: string;
      product: { name: string; tvaVente: number | null };
    }>;
  }>,
}));

/** Forces a real macrotask boundary, so concurrent flows genuinely interleave. */
const yieldToLoop = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeTx() {
  return {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join(" ");
      if (!/INSERT INTO invoice_counters/i.test(sql)) {
        throw new Error(`Unexpected raw SQL: ${sql}`);
      }
      const [pharmacyId, year] = values as [string, number];
      const key = `${pharmacyId}:${year}`;
      // Synchronous read-modify-write: nothing can interleave here, which
      // is precisely the guarantee the real single statement provides.
      const next = (state.counters.get(key) ?? 0) + 1;
      state.counters.set(key, next);
      return Promise.resolve([{ last_sequence: next }]);
    },
    sale: {
      findMany: async ({ where }: { where: { id: { in: string[] }; pharmacyId: string } }) => {
        await yieldToLoop();
        return state.sales.filter(
          (sale) =>
            where.id.in.includes(sale.id) &&
            sale.pharmacyId === where.pharmacyId &&
            sale.invoiceId === null,
        );
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id?: { in: string[] }; invoiceId?: string };
        data: { invoiceId: string | null };
      }) => {
        await yieldToLoop();
        for (const sale of state.sales) {
          const matchesIds = where.id ? where.id.in.includes(sale.id) : false;
          const matchesInvoice = where.invoiceId ? sale.invoiceId === where.invoiceId : false;
          if (matchesIds || matchesInvoice) sale.invoiceId = data.invoiceId;
        }
      },
    },
    pharmacy: {
      findUniqueOrThrow: async () => {
        await yieldToLoop();
        return state.pharmacy;
      },
    },
    invoice: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        await yieldToLoop();
        const found = state.invoices.find((invoice) => invoice.id === where.id);
        return found ? { id: found.id, status: found.status } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: { status: string } }) => {
        await yieldToLoop();
        const found = state.invoices.find((invoice) => invoice.id === where.id);
        if (found) found.status = data.status;
        return found;
      },
      create: async ({
        data,
      }: {
        data: { number: string; year: number; sequence: number };
      }) => {
        await yieldToLoop();
        // Mirrors @@unique([pharmacyId, number]): a duplicate must blow up
        // here rather than being quietly accepted.
        if (state.invoices.some((invoice) => invoice.number === data.number)) {
          throw new Error(`Unique constraint failed on invoices.number (${data.number})`);
        }
        const invoice = {
          id: `inv-${state.invoices.length + 1}`,
          number: data.number,
          year: data.year,
          sequence: data.sequence,
          status: "ISSUED",
        };
        state.invoices.push(invoice);
        return { id: invoice.id, number: invoice.number };
      },
    },
    // Ajouté avec la journalisation. Le journal est en ajout seul,
    // garanti par un déclencheur en base : le faux refuse donc les deux
    // autres opérations, comme la base le ferait.
    eventLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.journal.push({ ...data });
        return data;
      },
      update: async () => {
        throw new Error("event_log est un journal en ajout seul : UPDATE refuse.");
      },
      delete: async () => {
        throw new Error("event_log est un journal en ajout seul : DELETE refuse.");
      },
    },
  };
}

vi.mock("@/lib/db/client", () => ({
  prisma: {
    $transaction: async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx()),
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

const { cancelInvoice, createInvoiceFromSales } = await import("@/lib/server/invoices");

function seedSales(count: number) {
  state.sales = Array.from({ length: count }, (_, i) => ({
    id: `sale-${i + 1}`,
    pharmacyId: "pharmacy-1",
    clientId: null,
    invoiceId: null,
    client: null,
    items: [
      {
        quantity: 2,
        unitPrice: 50,
        productId: `p${i + 1}`,
        product: { name: `Produit ${i + 1}`, tvaVente: 20 },
      },
    ],
  }));
}

beforeEach(() => {
  state.counters = new Map();
  state.invoices = [];
  state.journal = [];
  seedSales(50);
});

describe("formatInvoiceNumber", () => {
  it("pads to the FACT-YYYY-NNNN format", () => {
    expect(formatInvoiceNumber(2026, 1)).toBe("FACT-2026-0001");
    expect(formatInvoiceNumber(2026, 42)).toBe("FACT-2026-0042");
  });

  it("widens past 9999 rather than wrapping or truncating", () => {
    expect(formatInvoiceNumber(2026, 10000)).toBe("FACT-2026-10000");
  });

  it("round-trips through parseInvoiceNumber", () => {
    expect(parseInvoiceNumber(formatInvoiceNumber(2026, 7))).toEqual({ year: 2026, sequence: 7 });
  });

  it("rejects anything that isn't one of our numbers", () => {
    expect(parseInvoiceNumber("FACT-26-1")).toBeNull();
    expect(parseInvoiceNumber("INV-2026-0001")).toBeNull();
  });
});

describe("sequential numbering under concurrency", () => {
  it("gives 50 invoices created simultaneously 50 distinct numbers", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => createInvoiceFromSales([`sale-${i + 1}`])),
    );

    const numbers = results.map((result) => result.number);
    expect(new Set(numbers).size).toBe(50);
  });

  it("leaves no gap in the sequence", async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => createInvoiceFromSales([`sale-${i + 1}`])),
    );

    const year = new Date().getFullYear();
    const sequences = state.invoices.map((invoice) => invoice.sequence).sort((a, b) => a - b);

    expect(sequences).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(state.invoices.map((i) => i.number)).toContain(formatInvoiceNumber(year, 1));
  });

  it("keeps sequences independent per pharmacy-year counter", async () => {
    await createInvoiceFromSales(["sale-1"]);
    const year = new Date().getFullYear();

    expect(state.counters.get(`pharmacy-1:${year}`)).toBe(1);
    expect(state.counters.size).toBe(1);
  });

  it("does not consume a number when creation is rejected before allocation", async () => {
    await createInvoiceFromSales(["sale-1"]);

    // Validation runs before the counter is touched, so a user error
    // (here: a sale already billed) leaves no gap in the sequence.
    state.sales[1]!.invoiceId = "already-billed";
    await expect(createInvoiceFromSales(["sale-2"])).rejects.toThrow(/introuvables ou déjà facturées/);

    const next = await createInvoiceFromSales(["sale-3"]);
    const year = new Date().getFullYear();
    expect(next.number).toBe(formatInvoiceNumber(year, 2));
  });

  it("never reuses the number of a cancelled invoice", async () => {
    const year = new Date().getFullYear();
    const first = await createInvoiceFromSales(["sale-1"]);
    expect(first.number).toBe(formatInvoiceNumber(year, 1));

    // Cancelling releases the sale for re-billing but must not rewind the
    // counter: the reissued invoice gets a fresh number.
    await cancelInvoice(first.id);
    const reissued = await createInvoiceFromSales(["sale-1"]);

    expect(reissued.number).toBe(formatInvoiceNumber(year, 2));
    expect(reissued.number).not.toBe(first.number);
  });

  it("refuses to bill a sale twice", async () => {
    await createInvoiceFromSales(["sale-1"]);

    await expect(createInvoiceFromSales(["sale-1"])).rejects.toThrow(
      /introuvables ou déjà facturées/,
    );
  });

  it("rejects grouping sales that belong to different clients", async () => {
    state.sales[0]!.clientId = "client-a";
    state.sales[0]!.client = { id: "client-a", name: "A" };
    state.sales[1]!.clientId = "client-b";
    state.sales[1]!.client = { id: "client-b", name: "B" };

    await expect(createInvoiceFromSales(["sale-1", "sale-2"])).rejects.toThrow(/même client/);
  });

  it("demonstrates the fake would expose a non-atomic allocator", async () => {
    // Guard against the test being vacuous: the same fake, driven by a
    // read-then-write allocator split across an await, must collide.
    const year = new Date().getFullYear();
    const racy = async () => {
      const current = state.counters.get(`pharmacy-1:${year}`) ?? 0;
      await yieldToLoop();
      const next = current + 1;
      state.counters.set(`pharmacy-1:${year}`, next);
      return formatInvoiceNumber(year, next);
    };

    const numbers = await Promise.all(Array.from({ length: 20 }, racy));

    expect(new Set(numbers).size).toBeLessThan(20);
  });
});

/**
 * La journalisation de la facturation.
 *
 * Ajoutée à côté de la numérotation, jamais dedans : les assertions de
 * concurrence ci-dessus — 50 factures simultanées, aucun trou dans la
 * séquence, aucun numéro réutilisé — portent sur le mécanisme que la
 * trace ne doit pas perturber, et elles passent inchangées.
 */
describe("journalisation d'une facture", () => {
  it("écrit une entrée du bon type, avec le numéro attribué", async () => {
    const facture = await createInvoiceFromSales(["sale-1", "sale-2"]);

    expect(state.journal).toHaveLength(1);
    const trace = state.journal[0]!;
    expect(trace.typeAction).toBe("facture.generee");
    expect(trace.entite).toBe("facture");
    expect(trace.entiteId).toBe(facture.id);
    // Le numéro dans l'instantané : il n'est jamais réattribué, et c'est
    // par lui qu'on retrouve une facture des mois plus tard.
    expect((trace.apres as { nom: string }).nom).toBe(facture.number);
    expect((trace.apres as { ventes: number }).ventes).toBe(2);
  });

  it("n'écrit rien quand la facturation est refusée", async () => {
    // La trace est dans la transaction : une facture refusée ne consomme
    // pas de numéro, et ne doit pas laisser de trace non plus.
    await expect(createInvoiceFromSales([])).rejects.toThrow();
    expect(state.journal).toHaveLength(0);
  });

  it("écrit une entrée par facture, jamais une de plus", async () => {
    await createInvoiceFromSales(["sale-1"]);
    await createInvoiceFromSales(["sale-2"]);
    expect(state.journal).toHaveLength(2);
    expect(state.journal.map((e) => e.typeAction)).toEqual([
      "facture.generee",
      "facture.generee",
    ]);
  });
});
