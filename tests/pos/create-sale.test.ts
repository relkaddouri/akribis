import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In-memory fake for the Prisma client, including a faithful
 * `$transaction`: it snapshots state before running the callback and
 * restores it if the callback throws, so these tests can prove
 * `createSale` really rolls back on an oversell instead of just
 * rejecting the request while leaving partial writes behind.
 */
const state = vi.hoisted(() => {
  type FakeProduct = {
    id: string;
    pharmacyId: string;
    name: string;
    price: number;
    quantityInStock: number;
    remboursable: boolean;
    baseRemboursement: number | null;
  };
  type FakeSale = {
    id: string;
    pharmacyId: string;
    userId: string;
    paymentMethod: string;
    totalAmount: number;
    createdAt: Date;
    insurerId: string | null;
    montantPartClient: number;
    montantPartAssurance: number;
    statutCreance: string;
  };
  type FakeSaleItem = {
    pharmacyId: string;
    saleId: string;
    productId: string;
    quantity: number;
    unitPrice: number;
  };
  type FakeStockMovement = {
    pharmacyId: string;
    productId: string;
    type: string;
    quantity: number;
    reason: string;
  };

  type FakeClient = { id: string; pharmacyId: string; name: string };
  type FakeInsurer = {
    id: string;
    pharmacyId: string;
    tauxCouverture: number;
    actif: boolean;
  };
  /** Ce que `createSale` a porté au compte du client, tel quel. */
  type FakeAccountMovement = {
    clientId: string;
    type: string;
    montant: number;
    saleId?: string;
    description?: string;
  };

  return {
    products: [] as FakeProduct[],
    sales: [] as FakeSale[],
    saleItems: [] as FakeSaleItem[],
    stockMovements: [] as FakeStockMovement[],
    clients: [] as FakeClient[],
    insurers: [] as FakeInsurer[],
    accountMovements: [] as FakeAccountMovement[],
    loyaltyAwards: [] as { clientId: string; points: number }[],
    journal: [] as Record<string, unknown>[],
    nextSaleId: 1,
  };
});

function makeTx() {
  return {
    product: {
      findMany: async ({
        where,
      }: {
        where: { id: { in: string[] }; pharmacyId: string };
      }) =>
        state.products.filter(
          (p) => where.id.in.includes(p.id) && p.pharmacyId === where.pharmacyId,
        ),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; pharmacyId: string; quantityInStock: { gte: number } };
        data: { quantityInStock: { decrement: number } };
      }) => {
        const matches = state.products.filter(
          (p) =>
            p.id === where.id &&
            p.pharmacyId === where.pharmacyId &&
            p.quantityInStock >= where.quantityInStock.gte,
        );
        for (const product of matches) {
          product.quantityInStock -= data.quantityInStock.decrement;
        }
        return { count: matches.length };
      },
    },
    sale: {
      create: async ({
        data,
      }: {
        data: Omit<(typeof state.sales)[number], "id" | "createdAt">;
      }) => {
        const sale = { id: `sale-${state.nextSaleId++}`, createdAt: new Date(), ...data };
        state.sales.push(sale);
        return sale;
      },
    },
    saleItem: {
      create: async ({ data }: { data: (typeof state.saleItems)[number] }) => {
        state.saleItems.push(data);
        return data;
      },
    },
    stockMovement: {
      create: async ({ data }: { data: (typeof state.stockMovements)[number] }) => {
        state.stockMovements.push(data);
        return data;
      },
    },
    client: {
      findFirst: async ({ where }: { where: { id: string; pharmacyId: string } }) =>
        state.clients.find((c) => c.id === where.id && c.pharmacyId === where.pharmacyId) ?? null,
    },
    organismeTiersPayant: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; pharmacyId: string; actif: boolean };
      }) =>
        state.insurers.find(
          (o) =>
            o.id === where.id && o.pharmacyId === where.pharmacyId && o.actif === where.actif,
        ) ?? null,
    },
    pharmacy: {
      findUniqueOrThrow: async () => ({ loyaltyRate: 1 }),
    },
    // Ajouté avec la journalisation des ventes. Le journal est en ajout
    // seul, garanti par un déclencheur en base : le faux refuse donc les
    // deux autres opérations, comme la base le ferait.
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
    $transaction: async <T>(fn: (tx: ReturnType<typeof makeTx>) => Promise<T>): Promise<T> => {
      const snapshot = {
        products: state.products.map((p) => ({ ...p })),
        sales: [...state.sales],
        saleItems: [...state.saleItems],
        stockMovements: [...state.stockMovements],
        journal: [...state.journal],
      };
      try {
        return await fn(makeTx());
      } catch (err) {
        state.products = snapshot.products;
        state.sales = snapshot.sales;
        state.saleItems = snapshot.saleItems;
        state.stockMovements = snapshot.stockMovements;
        // Annulé avec le reste : une vente refusée ne doit pas laisser
        // derrière elle la trace d'une vente qui n'a pas eu lieu.
        state.journal = snapshot.journal;
        throw err;
      }
    },
  },
}));

/**
 * Le compte client est simulé à sa frontière : ce qui est en jeu ici est
 * le montant que `createSale` lui remet, pas la façon dont le grand livre
 * l'enregistre — lib/server/client-account.ts a ses propres tests.
 */
vi.mock("@/lib/server/client-account", () => ({
  recordClientTransaction: async (
    _tx: unknown,
    _pharmacyId: string,
    input: (typeof state.accountMovements)[number],
  ) => {
    state.accountMovements.push(input);
  },
  addLoyaltyPoints: async (_tx: unknown, clientId: string, points: number) => {
    state.loyaltyAwards.push({ clientId, points });
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    role: "owner",
    pharmacyId: "pharmacy-1",
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

const { createSale } = await import("@/lib/server/sales");

function seedProduct(
  overrides: Partial<(typeof state.products)[number]> = {},
): (typeof state.products)[number] {
  const product = {
    id: overrides.id ?? "product-1",
    pharmacyId: overrides.pharmacyId ?? "pharmacy-1",
    name: overrides.name ?? "Doliprane 500mg",
    price: overrides.price ?? 12.5,
    quantityInStock: overrides.quantityInStock ?? 10,
    // Non remboursable par défaut : la vente ordinaire, celle que la
    // plupart de ces tests jouent.
    remboursable: overrides.remboursable ?? false,
    baseRemboursement: overrides.baseRemboursement ?? null,
  };
  state.products.push(product);
  return product;
}

function seedClient(id = "client-1", name = "Amina Benali") {
  const client = { id, pharmacyId: "pharmacy-1", name };
  state.clients.push(client);
  return client;
}

function seedInsurer(id = "cnops", tauxCouverture = 70) {
  const insurer = { id, pharmacyId: "pharmacy-1", tauxCouverture, actif: true };
  state.insurers.push(insurer);
  return insurer;
}

beforeEach(() => {
  state.products = [];
  state.sales = [];
  state.saleItems = [];
  state.stockMovements = [];
  state.clients = [];
  state.insurers = [];
  state.accountMovements = [];
  state.loyaltyAwards = [];
  state.journal = [];
  state.nextSaleId = 1;
});

describe("createSale", () => {
  it("decrements stock by the sold quantity", async () => {
    seedProduct({ id: "p1", quantityInStock: 10, price: 12.5 });

    await createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 3 }] });

    expect(state.products.find((p) => p.id === "p1")?.quantityInStock).toBe(7);
  });

  it("records a matching sale, sale item and stock movement", async () => {
    seedProduct({ id: "p1", quantityInStock: 10, price: 12.5 });

    const receipt = await createSale({
      paymentMethod: "CARD",
      items: [{ productId: "p1", quantity: 2 }],
    });

    expect(receipt.totalAmount).toBe(25);
    expect(receipt.paymentMethod).toBe("CARD");
    expect(state.sales).toHaveLength(1);
    expect(state.sales[0]).toMatchObject({ id: receipt.id, paymentMethod: "CARD", totalAmount: 25 });

    expect(state.saleItems).toHaveLength(1);
    expect(state.saleItems[0]).toMatchObject({
      saleId: receipt.id,
      productId: "p1",
      quantity: 2,
      unitPrice: 12.5,
    });

    expect(state.stockMovements).toHaveLength(1);
    expect(state.stockMovements[0]).toMatchObject({ productId: "p1", type: "OUT", quantity: 2 });
  });

  it("rejects a sale that exceeds available stock", async () => {
    seedProduct({ id: "p1", quantityInStock: 2, price: 12.5 });

    await expect(
      createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 5 }] }),
    ).rejects.toThrow(/stock insuffisant/i);

    // Nothing was written: not the stock, not the sale.
    expect(state.products.find((p) => p.id === "p1")?.quantityInStock).toBe(2);
    expect(state.sales).toHaveLength(0);
    expect(state.saleItems).toHaveLength(0);
  });

  it("rolls back the whole cart when only one line oversells (atomicity)", async () => {
    seedProduct({ id: "ok", quantityInStock: 10, price: 5 });
    seedProduct({ id: "short", quantityInStock: 1, price: 5 });

    await expect(
      createSale({
        paymentMethod: "CASH",
        items: [
          { productId: "ok", quantity: 3 },
          { productId: "short", quantity: 5 },
        ],
      }),
    ).rejects.toThrow(/stock insuffisant/i);

    // The first line's stock decrement must be undone too, not just the
    // failing one — otherwise a multi-item sale could partially apply.
    expect(state.products.find((p) => p.id === "ok")?.quantityInStock).toBe(10);
    expect(state.products.find((p) => p.id === "short")?.quantityInStock).toBe(1);
    expect(state.sales).toHaveLength(0);
  });

  it("scopes the sale to the caller's pharmacy and rejects a product from another pharmacy", async () => {
    seedProduct({ id: "other-pharmacy-product", pharmacyId: "pharmacy-2", quantityInStock: 10 });

    await expect(
      createSale({
        paymentMethod: "CASH",
        items: [{ productId: "other-pharmacy-product", quantity: 1 }],
      }),
    ).rejects.toThrow(/introuvable/i);

    expect(state.sales).toHaveLength(0);
  });
});

describe("the price the customer actually paid", () => {
  /**
   * Diagnostic bug ③. A sale made offline prints its ticket from the price
   * held on the device, but the queued payload carried only
   * {productId, quantity}: at sync time the server priced the line from the
   * catalogue instead. Change the shelf price in between — the usual case
   * being a supplier price rise applied in the morning — and the customer
   * walked out with a ticket the accounts disagreed with.
   */
  it("charges the ticket price, not the catalogue price at sync time", async () => {
    const product = seedProduct({ id: "p1", quantityInStock: 10, price: 10 });

    // The sale happened at 10. Overnight the catalogue moved to 15, and
    // only now does the queued write reach the server.
    product.price = 15;

    const receipt = await createSale({
      paymentMethod: "CASH",
      items: [{ productId: "p1", quantity: 2, unitPrice: 10 }],
    });

    // 20, the figure on the customer's ticket — not 30.
    expect(receipt.totalAmount).toBe(20);
    expect(state.sales[0]!.totalAmount).toBe(20);
    expect(state.saleItems[0]!.unitPrice).toBe(10);
  });

  it("reports the gap without changing what was charged", async () => {
    const product = seedProduct({ id: "p1", quantityInStock: 10, price: 10 });
    product.price = 15;

    const receipt = await createSale({
      paymentMethod: "CASH",
      items: [{ productId: "p1", quantity: 2, unitPrice: 10 }],
    });

    // The amount stands; the discrepancy is merely recorded, so an unusual
    // one can be looked into afterwards.
    expect(receipt.totalAmount).toBe(20);
    expect(receipt.priceDrifts).toEqual([
      { productId: "p1", productName: "Doliprane 500mg", chargedPrice: 10, catalogPrice: 15 },
    ]);
  });

  it("says nothing when the price never moved", async () => {
    seedProduct({ id: "p1", quantityInStock: 10, price: 12.5 });

    const receipt = await createSale({
      paymentMethod: "CASH",
      items: [{ productId: "p1", quantity: 2, unitPrice: 12.5 }],
    });

    expect(receipt.priceDrifts).toEqual([]);
  });

  it("falls back to the catalogue price when the payload carries none", async () => {
    // Items queued before prices were included, and the online path if it
    // ever calls this directly: unchanged behaviour, no drift to report.
    seedProduct({ id: "p1", quantityInStock: 10, price: 12.5 });

    const receipt = await createSale({
      paymentMethod: "CASH",
      items: [{ productId: "p1", quantity: 2 }],
    });

    expect(receipt.totalAmount).toBe(25);
    expect(receipt.priceDrifts).toEqual([]);
  });

  it("refuses a negative price rather than trusting the client blindly", async () => {
    seedProduct({ id: "p1", quantityInStock: 10, price: 12.5 });

    await expect(
      createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 1, unitPrice: -5 }] }),
    ).rejects.toThrow();
  });
});

/**
 * Ce qu'une vente à crédit porte au compte du client.
 *
 * Le compte client et le bordereau tiers payant sont deux canaux
 * d'encaissement distincts : le premier réclame au client, le second à
 * l'organisme. Une vente conventionnée alimente les deux, et la somme de
 * ce qu'ils réclament doit faire le ticket — pas davantage.
 *
 * Le compte était débité du ticket entier alors que la part organisme
 * partait *aussi* en réclamation sur un bordereau, et rien ne recréditait
 * jamais le client : lib/server/bordereaux.ts, au règlement, bascule
 * `statutCreance` à PAYEE sans écrire au compte. La part organisme était
 * donc encaissée deux fois, et le client la devait pour toujours.
 */
describe("une vente à crédit chez un client conventionné", () => {
  it("ne porte au compte que la part client, jamais la part organisme", async () => {
    seedProduct({
      id: "p1",
      quantityInStock: 10,
      price: 100,
      remboursable: true,
      baseRemboursement: 80,
    });
    seedClient();
    seedInsurer("cnops", 70);

    const receipt = await createSale({
      paymentMethod: "CREDIT",
      clientId: "client-1",
      insurerId: "cnops",
      items: [{ productId: "p1", quantity: 1, unitPrice: 100 }],
    });

    // Base 80 couverte à 70 % : 56 pour l'organisme, 44 pour le client.
    expect(receipt.totalAmount).toBe(100);
    expect(receipt.partAssurance).toBe(56);
    expect(receipt.partClient).toBe(44);

    expect(state.accountMovements).toHaveLength(1);
    expect(state.accountMovements[0]).toMatchObject({
      clientId: "client-1",
      type: "vente",
      saleId: receipt.id,
      // 44, et non -100. Négatif : le client doit (voir Client.solde).
      montant: -44,
    });
  });

  it("laisse la part organisme au bordereau, et à lui seul", async () => {
    seedProduct({
      id: "p1",
      quantityInStock: 10,
      price: 100,
      remboursable: true,
      baseRemboursement: 80,
    });
    seedClient();
    seedInsurer("cnops", 70);

    const receipt = await createSale({
      paymentMethod: "CREDIT",
      clientId: "client-1",
      insurerId: "cnops",
      items: [{ productId: "p1", quantity: 1, unitPrice: 100 }],
    });

    // La vente réclame bien 56 à l'organisme : c'est ce montant que
    // lib/server/bordereaux.ts reprend en `montantReclame`.
    expect(state.sales[0]).toMatchObject({
      montantPartAssurance: 56,
      montantPartClient: 44,
      statutCreance: "EN_ATTENTE_BORDEREAU",
    });

    // L'invariant, et la raison d'être de tout ce bloc : ce que les deux
    // canaux réclament ensemble fait le ticket, exactement.
    const duParLeClient = -state.accountMovements[0]!.montant;
    expect(duParLeClient + Number(state.sales[0]!.montantPartAssurance)).toBe(
      receipt.totalAmount,
    );
  });

  it("porte le ticket entier au compte quand aucun organisme n'intervient", async () => {
    // Le cas ordinaire, inchangé : sans organisme `partClient` vaut le
    // total, et le client doit tout.
    seedProduct({ id: "p1", quantityInStock: 10, price: 100 });
    seedClient();

    const receipt = await createSale({
      paymentMethod: "CREDIT",
      clientId: "client-1",
      items: [{ productId: "p1", quantity: 2, unitPrice: 100 }],
    });

    expect(receipt.totalAmount).toBe(200);
    expect(state.accountMovements[0]).toMatchObject({ montant: -200 });
    expect(state.sales[0]).toMatchObject({ statutCreance: "AUCUNE" });
  });

  it("ne porte rien au compte quand un produit conventionné est réglé comptant", async () => {
    // Payé au comptoir : il n'y a pas de créance sur le client, seulement
    // celle sur l'organisme.
    seedProduct({
      id: "p1",
      quantityInStock: 10,
      price: 100,
      remboursable: true,
      baseRemboursement: 80,
    });
    seedClient();
    seedInsurer("cnops", 70);

    await createSale({
      paymentMethod: "CASH",
      clientId: "client-1",
      insurerId: "cnops",
      items: [{ productId: "p1", quantity: 1, unitPrice: 100 }],
    });

    expect(state.accountMovements).toEqual([]);
    expect(state.sales[0]).toMatchObject({ statutCreance: "EN_ATTENTE_BORDEREAU" });
  });
});

/**
 * La journalisation des ventes.
 *
 * Ajoutée **à côté** de la logique de vente, jamais dedans : c'est ce que
 * vérifient d'abord les dizaines d'assertions déjà présentes dans ce
 * fichier, qui portent sur le stock, les montants, le compte client et le
 * remboursement, et qui doivent continuer de passer à l'identique.
 */
describe("journalisation d'une vente", () => {
  const derniere = () => state.journal.at(-1)!;

  it("écrit une entrée du bon type après la vente", async () => {
    seedProduct({ id: "p1", quantityInStock: 10, price: 12.5 });

    const recu = await createSale({
      paymentMethod: "CASH",
      items: [{ productId: "p1", quantity: 2 }],
    });

    expect(state.journal).toHaveLength(1);
    expect(derniere().typeAction).toBe("vente.creee");
    expect(derniere().entite).toBe("vente");
    expect(derniere().entiteId).toBe(recu.id);
    expect(derniere().pharmacyId).toBe("pharmacy-1");
  });

  it("n'a pas d'état « avant », et retient ce qui se relit sans rouvrir la vente", async () => {
    seedProduct({ id: "p1", quantityInStock: 10, price: 12.5 });

    await createSale({ paymentMethod: "CARD", items: [{ productId: "p1", quantity: 2 }] });

    // La vente n'existait pas : un « avant » serait une invention.
    expect(derniere().avant).toBeUndefined();
    expect(derniere().apres).toMatchObject({ montant: 25, paiement: "CARD", lignes: 1 });
  });

  it("n'écrit rien quand la vente est refusée", async () => {
    // Le point qui compte : la trace est dans la transaction. Une vente
    // annulée pour survente ne doit pas laisser derrière elle la marque
    // d'une vente qui n'a pas eu lieu.
    seedProduct({ id: "p1", quantityInStock: 1, price: 12.5 });

    await expect(
      createSale({ paymentMethod: "CASH", items: [{ productId: "p1", quantity: 5 }] }),
    ).rejects.toThrow();

    expect(state.journal).toHaveLength(0);
    expect(state.sales).toHaveLength(0);
  });
});
