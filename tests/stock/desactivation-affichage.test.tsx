import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderAvecProviders } from "@/tests/fixtures/render-avec-providers";
import { getDb, type LocalProduct } from "@/lib/offline/db";
import { setOfflineSession } from "@/lib/offline/session";
import { ProductTable, filters } from "@/components/features/stock/product-table";
import type { ProductRecord } from "@/lib/offline/products";

/**
 * L'autre moitié de la désactivation locale : ce qu'un produit retiré de
 * la vente cesse d'être, et ce qu'il reste.
 *
 * Le point qui se casse le plus facilement est la frontière entre les deux
 * lectures. « Ne plus le proposer » (comptoir, commande) et « ne plus le
 * voir » (stock, inventaire) ne sont pas la même chose : confondre les
 * deux ferait disparaître du stock des boîtes qui sont physiquement sur
 * l'étagère, et un inventaire ne les compterait plus.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const bascule = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
vi.mock("@/lib/server/stock-entry", () => ({ setProductActifLocalement: bascule }));
vi.mock("@/lib/server/products", () => ({
  listProducts: vi.fn(async () => []),
  getProduct: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
}));

const { listProducts } = await import("@/lib/offline/products");

function produit(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: "p1",
    pharmacyId: "ph1",
    name: "DOLIPRANE 500 mg",
    form: "Comprimé",
    dosage: "500 mg",
    laboratory: "Sanofi",
    barcode: "6111234567893",
    dci: "Paracétamol",
    photoUrl: null,
    category: "Antalgiques / Antipyrétiques",
    categorie: "PHARMACEUTIQUE",
    sousCategorie: null,
    actifLocalement: true,
    price: 18,
    pph: 12.4,
    tvaVente: 7,
    tvaAchat: 7,
    lowStockThreshold: 10,
    quantityInStock: 50,
    nearestExpiryDate: null,
    remboursable: true,
    baseRemboursement: 15,
    posologieEnfant: null,
    posologieAdulte: null,
    monographie: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ProductRecord;
}

const retire = produit({ id: "p2", name: "SMECTA", barcode: "611000", actifLocalement: false });

describe("ce que le comptoir cesse de proposer", () => {
  beforeEach(async () => {
    setOfflineSession("ph1", "user-1");
    await getDb().products.clear();
    await getDb().products.bulkPut(
      [produit(), retire].map((p) => ({ ...p, syncStatus: "synced" }) as unknown as LocalProduct),
    );
  });

  it("ne propose plus un produit retiré de la vente", async () => {
    const proposes = await listProducts({ actifsSeulement: true });
    expect(proposes.map((p) => p.name)).toEqual(["DOLIPRANE 500 mg"]);
  });

  it("ne le retrouve pas non plus par son code-barres", async () => {
    // Le chemin du scanner : recherche exacte puis correspondance sur le
    // code. Un produit retiré ne doit pas s'ajouter à une vente, même scanné.
    const trouves = await listProducts({ search: "611000", actifsSeulement: true });
    expect(trouves).toEqual([]);
  });

  it("mais le stock et l'inventaire continuent de le voir", async () => {
    const tout = await listProducts();
    expect(tout.map((p) => p.name).sort()).toEqual(["DOLIPRANE 500 mg", "SMECTA"]);
  });

  it("traite comme actif une ligne mise en cache avant l'ajout du champ", async () => {
    const ancienne: Record<string, unknown> = { ...produit({ id: "p3", name: "EFFERALGAN" }) };
    delete ancienne.actifLocalement;
    await getDb().products.put({ ...ancienne, syncStatus: "synced" } as unknown as LocalProduct);

    const proposes = await listProducts({ actifsSeulement: true });
    expect(
      proposes.map((p) => p.name),
      "Un cache incomplet ne doit jamais faire disparaître un produit du comptoir.",
    ).toContain("EFFERALGAN");

    // Et pas seulement le laisser passer : la valeur relue doit être
    // `true`, sinon la liste du stock l'afficherait « Retiré de la vente »
    // et l'interrupteur serait à l'envers.
    expect(proposes.find((p) => p.name === "EFFERALGAN")!.actifLocalement).toBe(true);
  });
});

describe("ce que la liste du stock en montre", () => {
  const renderTable = (products: ProductRecord[]) =>
    renderAvecProviders(
      <ProductTable products={products} isLoading={false} search="" onSearchChange={() => {}} />,
    );

  const ligne = (nom: string) => screen.getByText(nom).closest("tr")!;

  it("marque le produit retiré au lieu de le faire disparaître", () => {
    renderTable([produit(), retire]);
    expect(screen.getByText("SMECTA")).toBeTruthy();
    expect(within(ligne("SMECTA")).getByText("Retiré de la vente")).toBeTruthy();
  });

  it("ne marque pas les produits en vente", () => {
    renderTable([produit()]);
    expect(within(ligne("DOLIPRANE 500 mg")).queryByText("Retiré de la vente")).toBeNull();
  });

  it("offre l'interrupteur sur chaque ligne", () => {
    renderTable([produit(), retire]);
    expect(screen.getByRole("switch", { name: /Retirer de la vente DOLIPRANE/ })).toBeTruthy();
    expect(screen.getByRole("switch", { name: /Remettre en vente SMECTA/ })).toBeTruthy();
  });

  it("propose un filtre Disponibilité, distinct du niveau de stock", () => {
    renderTable([produit(), retire]);
    expect(screen.getByText("Disponibilité : tous")).toBeTruthy();
    expect(screen.getByText("Statut : tous")).toBeTruthy();
  });

  it("le filtre Disponibilité sépare bien les deux", () => {
    const dispo = filters.find((f) => f.id === "disponibilite")!;
    expect(dispo.predicate(produit(), "actifs")).toBe(true);
    expect(dispo.predicate(retire, "actifs")).toBe(false);
    expect(dispo.predicate(retire, "retires")).toBe(true);
    expect(dispo.predicate(produit(), "retires")).toBe(false);
  });

  it("dit ce qui s'est passé quand la bascule échoue faute de réseau", async () => {
    // Le message ne parle de connexion que si le navigateur est réellement
    // hors ligne — sans quoi il diagnostiquerait la mauvaise cause.
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    bascule.mockRejectedValueOnce(new Error("Failed to fetch"));
    renderTable([produit()]);

    fireEvent.click(screen.getByRole("switch", { name: /Retirer de la vente DOLIPRANE/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Retirer de la vente" }));

    // Sans filet, la promesse serait rejetée sans que rien ne bouge, et le
    // pharmacien croirait le produit retiré alors qu'il est toujours en vente.
    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toMatch(/hors connexion/i);
  });

  it("un produit retiré peut aussi être en rupture — les deux filtres sont indépendants", () => {
    const rupture = produit({ id: "p4", name: "AMOXIL", actifLocalement: false, quantityInStock: 0 });
    const dispo = filters.find((f) => f.id === "disponibilite")!;
    const statut = filters.find((f) => f.id === "stockStatus")!;
    expect(dispo.predicate(rupture, "retires")).toBe(true);
    expect(statut.predicate(rupture, "out")).toBe(true);
  });
});
