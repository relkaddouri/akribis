import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La journalisation d'un retour de vente.
 *
 * Un retour rend de l'argent et, le plus souvent, remet la marchandise en
 * stock : c'est l'opération de caisse la plus facile à détourner, et
 * celle dont on veut savoir qui l'a passée. Le journal en retient le
 * changement de statut — aucun → partiel → total — parce que c'est la
 * seule chose que l'opération modifie sur une ligne existante.
 *
 * Le faux Prisma reste minimal : la mécanique du retour (quantités,
 * remboursement, remise en stock) est déjà couverte par
 * tests/sales/returns.test.ts sur les fonctions pures. Ce qui est en jeu
 * ici, c'est la trace, et le fait qu'elle ne change rien au reste.
 */

const state = vi.hoisted(() => ({
  journal: [] as Record<string, unknown>[],
  retours: [] as Record<string, unknown>[],
  mouvements: [] as Record<string, unknown>[],
  statutVente: "NONE",
  retournees: 0,
  /** Fait échouer l'incrément concurrent, comme le ferait une course réelle. */
  refuserIncrement: false,
}));

class FauxDecimal {
  constructor(private readonly v: number) {}
  toString() {
    return String(this.v);
  }
}
vi.mock("@/lib/db/generated/client", () => ({ Prisma: { Decimal: FauxDecimal } }));

vi.mock("@/lib/db/client", () => {
  const tx = {
    sale: {
      findFirst: async () => ({
        id: "sale-1",
        pharmacyId: "pharmacy-1",
        returnStatus: state.statutVente,
        items: [
          {
            id: "si-1",
            productId: "p1",
            quantity: 3,
            returnedQuantity: state.retournees,
            unitPrice: 20,
            product: { name: "DOLIPRANE 500 mg" },
          },
        ],
      }),
      update: async ({ data }: { data: { returnStatus: string } }) => {
        state.statutVente = data.returnStatus;
        return { id: "sale-1" };
      },
    },
    saleReturn: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.retours.push({ ...data });
        return { id: `ret-${state.retours.length}` };
      },
    },
    saleItem: {
      updateMany: async ({
        data,
      }: {
        data: { returnedQuantity: { increment: number } };
      }) => {
        if (state.refuserIncrement) return { count: 0 };
        // La quantité demandée, et non un pas de 1 : sans cela le statut
        // relu après coup ne pouvait jamais valoir « total », et une
        // assertion sur « partiel ou total » passait quoi qu'il arrive.
        state.retournees += data.returnedQuantity.increment;
        return { count: 1 };
      },
      findMany: async () => [{ quantity: 3, returnedQuantity: state.retournees }],
    },
    product: { update: async () => ({}) },
    stockMovement: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.mouvements.push({ ...data });
        return data;
      },
    },
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

  return {
    prisma: {
      $transaction: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => {
        const avant = {
          journal: [...state.journal],
          retours: [...state.retours],
          mouvements: [...state.mouvements],
          statutVente: state.statutVente,
          retournees: state.retournees,
        };
        try {
          return await fn(tx);
        } catch (err) {
          Object.assign(state, avant);
          throw err;
        }
      },
    },
  };
});

vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({
    id: "user-1",
    email: "titulaire@akribis.test",
    name: "Titulaire",
    role: "owner",
    pharmacyId: "pharmacy-1",
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { createSaleReturn } = await import("@/lib/server/sales-returns");

beforeEach(() => {
  state.journal = [];
  state.retours = [];
  state.mouvements = [];
  state.statutVente = "NONE";
  state.retournees = 0;
  state.refuserIncrement = false;
});

const derniere = () => state.journal.at(-1)!;

describe("journalisation d'un retour de vente", () => {
  it("écrit une entrée du bon type, rattachée à la vente", async () => {
    await createSaleReturn("sale-1", {
      lines: [{ saleItemId: "si-1", quantity: 1, restock: true }],
      isLotRecall: false,
    });

    expect(state.journal).toHaveLength(1);
    expect(derniere().typeAction).toBe("vente.retour");
    // Rattachée à la VENTE, pas au retour : c'est sur la vente qu'on
    // vient chercher son historique, et l'identifiant du retour ne dit
    // rien à qui le lit.
    expect(derniere().entite).toBe("vente");
    expect(derniere().entiteId).toBe("sale-1");
    expect(derniere().pharmacyId).toBe("pharmacy-1");
  });

  it("montre le passage d'un statut de retour à l'autre", async () => {
    await createSaleReturn("sale-1", {
      lines: [{ saleItemId: "si-1", quantity: 1, restock: true }],
      isLotRecall: false,
    });

    expect(derniere().avant).toMatchObject({ statutRetour: "NONE" });
    expect(derniere().apres).toMatchObject({ statutRetour: "PARTIAL", rembourse: 20 });
  });

  it("distingue un retour total d'un retour partiel", async () => {
    // Les trois unités vendues sont rendues : le statut passe à « total »,
    // et le journal doit le dire — c'est la différence entre un client
    // qui rapporte une boîte et un qui annule tout son achat.
    await createSaleReturn("sale-1", {
      lines: [{ saleItemId: "si-1", quantity: 3, restock: true }],
      isLotRecall: false,
    });

    expect(derniere().avant).toMatchObject({ statutRetour: "NONE" });
    expect(derniere().apres).toMatchObject({ statutRetour: "FULL", rembourse: 60 });
  });

  it("retient le rappel de lot, qui n'est pas un retour ordinaire", async () => {
    // Un rappel de lot se rejoue en inspection : savoir lesquels des
    // retours en étaient change la lecture du journal.
    await createSaleReturn("sale-1", {
      lines: [{ saleItemId: "si-1", quantity: 1, restock: true }],
      isLotRecall: true,
      recallReference: "LOT-2026-04",
    });

    expect(derniere().apres).toMatchObject({ rappelDeLot: true });
  });

  it("n'écrit rien quand le retour est refusé", async () => {
    await expect(
      createSaleReturn("sale-1", {
        lines: [{ saleItemId: "si-1", quantity: 99, restock: true }],
        isLotRecall: false,
      }),
    ).rejects.toThrow();

    expect(state.journal).toHaveLength(0);
    expect(state.retours).toHaveLength(0);
  });

  it("n'écrit rien quand une quantité a été retournée entre-temps", async () => {
    // La trace vit dans la transaction : la course perdue annule le
    // retour, et doit annuler sa trace avec lui.
    state.refuserIncrement = true;

    await expect(
      createSaleReturn("sale-1", {
        lines: [{ saleItemId: "si-1", quantity: 1, restock: true }],
        isLotRecall: false,
      }),
    ).rejects.toThrow("rechargez la vente");

    expect(state.journal).toHaveLength(0);
  });
});
