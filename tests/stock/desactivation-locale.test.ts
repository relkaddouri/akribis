import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Une officine peut retirer un produit de sa propre vente.
 *
 * Ce que la bascule doit garantir, et que ce fichier vérifie :
 *
 *   - elle ne supprime rien — lots, mouvements et ventes passées sont ce
 *     qui rend la comptabilité exacte, et un produit « retiré » qui
 *     effacerait son historique serait une perte de données déguisée ;
 *   - elle ne franchit pas la frontière de l'officine, ni vers une autre
 *     pharmacie, ni vers le catalogue national ;
 *   - elle est réversible.
 *
 * Faux Prisma en mémoire, comme tests/orders/receive-order.test.ts : la
 * vraie façade s'exécute, seul Postgres est remplacé.
 */

const state = vi.hoisted(() => ({
  products: [] as Array<{
    id: string;
    pharmacyId: string;
    catalogueProduitId: string | null;
    actifLocalement: boolean;
  }>,
  pharmacyStock: [] as Array<{
    pharmacyId: string;
    catalogueProduitId: string;
    actifLocalement: boolean;
  }>,
  catalogue: [] as Array<{ id: string; actifCatalogue: boolean }>,
  /** Tout appel destructeur passe par ici — il doit rester vide. */
  destructions: [] as string[],
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    product: {
      findFirst: async ({ where }: { where: { id: string; pharmacyId: string } }) =>
        state.products.find((p) => p.id === where.id && p.pharmacyId === where.pharmacyId) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { actifLocalement: boolean };
      }) => {
        const found = state.products.find((p) => p.id === where.id)!;
        found.actifLocalement = data.actifLocalement;
        return found;
      },
      delete: async () => state.destructions.push("product.delete"),
      deleteMany: async () => state.destructions.push("product.deleteMany"),
    },
    pharmacyStock: {
      updateMany: async ({
        where,
        data,
      }: {
        where: { pharmacyId: string; catalogueProduitId: string };
        data: { actifLocalement: boolean };
      }) => {
        const touched = state.pharmacyStock.filter(
          (s) =>
            s.pharmacyId === where.pharmacyId &&
            s.catalogueProduitId === where.catalogueProduitId,
        );
        for (const row of touched) row.actifLocalement = data.actifLocalement;
        return { count: touched.length };
      },
    },
    catalogueProduit: {
      update: async () => state.destructions.push("catalogueProduit.update"),
    },
    productLot: { deleteMany: async () => state.destructions.push("productLot.deleteMany") },
    saleItem: { deleteMany: async () => state.destructions.push("saleItem.deleteMany") },
    stockMovement: { deleteMany: async () => state.destructions.push("stockMovement.deleteMany") },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({
    id: "user-1",
    email: "owner@akribis.test",
    name: "Titulaire",
    role: "owner",
    pharmacyId: "ph1",
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { setProductActifLocalement } = await import("@/lib/server/stock-entry");

beforeEach(() => {
  state.products = [
    { id: "p1", pharmacyId: "ph1", catalogueProduitId: "c1", actifLocalement: true },
    // Saisi à la main : aucune ligne pharmacy_stock derrière lui.
    { id: "p2", pharmacyId: "ph1", catalogueProduitId: null, actifLocalement: true },
    // Une autre officine, même fiche catalogue.
    { id: "p3", pharmacyId: "ph2", catalogueProduitId: "c1", actifLocalement: true },
  ];
  state.pharmacyStock = [
    { pharmacyId: "ph1", catalogueProduitId: "c1", actifLocalement: true },
    { pharmacyId: "ph2", catalogueProduitId: "c1", actifLocalement: true },
  ];
  state.catalogue = [{ id: "c1", actifCatalogue: true }];
  state.destructions = [];
});

describe("retirer un produit de la vente", () => {
  it("bascule le drapeau du produit", async () => {
    const result = await setProductActifLocalement("p1", false);
    expect(result).toEqual({ ok: true });
    expect(state.products.find((p) => p.id === "p1")!.actifLocalement).toBe(false);
  });

  it("est réversible", async () => {
    await setProductActifLocalement("p1", false);
    await setProductActifLocalement("p1", true);
    expect(state.products.find((p) => p.id === "p1")!.actifLocalement).toBe(true);
  });

  it("ne supprime jamais rien", async () => {
    await setProductActifLocalement("p1", false);
    expect(
      state.destructions,
      "Retirer un produit de la vente doit laisser lots, mouvements et ventes intacts.",
    ).toEqual([]);
  });

  it("fonctionne sur un produit saisi à la main, sans fiche catalogue", async () => {
    const result = await setProductActifLocalement("p2", false);
    expect(result).toEqual({ ok: true });
    expect(state.products.find((p) => p.id === "p2")!.actifLocalement).toBe(false);
  });
});

describe("la désactivation ne sort pas de l'officine", () => {
  it("ne touche pas au même produit dans une autre pharmacie", async () => {
    await setProductActifLocalement("p1", false);
    expect(state.products.find((p) => p.id === "p3")!.actifLocalement).toBe(true);
    expect(
      state.pharmacyStock.find((s) => s.pharmacyId === "ph2")!.actifLocalement,
      "La copie de l'autre officine porte la même clé catalogue : le filtre " +
        "pharmacyId est la seule chose qui l'empêche d'être écrasée.",
    ).toBe(true);
  });

  it("refuse un produit d'une autre pharmacie", async () => {
    const result = await setProductActifLocalement("p3", false);
    expect(result).toEqual({ ok: false, error: "Produit introuvable." });
    expect(state.products.find((p) => p.id === "p3")!.actifLocalement).toBe(true);
  });

  it("ne touche jamais au statut national de la fiche", async () => {
    await setProductActifLocalement("p1", false);
    expect(state.catalogue[0]!.actifCatalogue).toBe(true);
    expect(state.destructions).not.toContain("catalogueProduit.update");
  });

  it("aligne la copie pharmacy_stock de cette officine", async () => {
    await setProductActifLocalement("p1", false);
    expect(state.pharmacyStock.find((s) => s.pharmacyId === "ph1")!.actifLocalement).toBe(false);
  });
});
