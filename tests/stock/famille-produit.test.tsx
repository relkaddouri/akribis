import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderAvecProviders } from "@/tests/fixtures/render-avec-providers";
import { getDb, type LocalProduct } from "@/lib/offline/db";
import { setOfflineSession } from "@/lib/offline/session";
import { ProductTable, filters } from "@/components/features/stock/product-table";
import { StockDetailView } from "@/components/features/stock/stock-detail-view";
import type { ProductRecord } from "@/lib/offline/products";
import type { ProductRecord as ServerProduct } from "@/lib/server/products";
import type { StockSheet } from "@/lib/server/stock-entry";

// La couche hors-ligne importe la façade serveur ; on la neutralise, ce
// test ne parle qu'au cache local.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/server/stock-entry", () => ({
  setProductActifLocalement: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("@/lib/server/products", () => ({
  listProducts: vi.fn(async () => []),
  getProduct: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
}));

const { listProducts: listProductsHorsLigne } = await import("@/lib/offline/products");

/**
 * Rien, côté officine, ne distinguait un médicament d'un produit de
 * parapharmacie : la colonne « Catégorie » de la liste affichait la classe
 * thérapeutique — vide pour toute la parapharmacie — et l'en-tête de la
 * fiche ne portait aucune marque de famille. Les deux onglets qu'on ouvre
 * en premier (Stock, Organisation) étant identiques dans les deux profils,
 * une fiche para se lisait exactement comme celle d'un médicament.
 */

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

const para = produit({
  id: "p2",
  name: "Puressentiel Articulations",
  form: "Spray",
  dosage: null,
  // Ce que porte réellement la ligne importée : pas de classe
  // thérapeutique, donc « — » dans l'ancienne colonne.
  category: null,
  categorie: "PARAPHARMACEUTIQUE",
  sousCategorie: "Complexes d'huiles essentielles",
});

const renderTable = (products: ProductRecord[]) =>
  renderAvecProviders(
    <ProductTable products={products} isLoading={false} search="" onSearchChange={() => {}} />,
  );

function ligne(nom: string) {
  return screen.getByText(nom).closest("tr")!;
}

describe("la liste du stock distingue les deux familles", () => {
  it("annonce la famille de chaque produit", () => {
    renderTable([produit(), para]);
    expect(within(ligne("DOLIPRANE 500 mg")).getByText("Pharmaceutique")).toBeTruthy();
    expect(within(ligne("Puressentiel Articulations")).getByText("Parapharmaceutique")).toBeTruthy();
  });

  it("montre la sous-catégorie là où la classe thérapeutique est vide", () => {
    renderTable([para]);
    expect(
      within(ligne("Puressentiel Articulations")).getByText("Complexes d'huiles essentielles"),
    ).toBeTruthy();
  });

  it("garde la classe thérapeutique d'un médicament", () => {
    renderTable([produit()]);
    expect(
      within(ligne("DOLIPRANE 500 mg")).getByText("Antalgiques / Antipyrétiques"),
    ).toBeTruthy();
  });

  it("signale un produit sans famille plutôt que de laisser la case vide", () => {
    renderTable([produit({ name: "Saisie manuelle", categorie: null, category: null })]);
    expect(within(ligne("Saisie manuelle")).getByText("À classer")).toBeTruthy();
  });

  // Le prédicat plutôt que le Select : piloter un Select Radix sous jsdom
  // teste surtout Radix, alors que le tri des familles est ici.
  const famille = filters.find((f) => f.id === "famille")!;

  it("propose bien un filtre Famille", () => {
    renderTable([produit(), para]);
    expect(screen.getByText("Famille : tous")).toBeTruthy();
  });

  it("le filtre Famille ne garde que la famille choisie", () => {
    expect(famille.predicate(para, "PARAPHARMACEUTIQUE")).toBe(true);
    expect(famille.predicate(produit(), "PARAPHARMACEUTIQUE")).toBe(false);
    expect(famille.predicate(produit(), "PHARMACEUTIQUE")).toBe(true);
  });

  it("« À classer » attrape les produits sans famille, et eux seuls", () => {
    const manuel = produit({ categorie: null });
    expect(famille.predicate(manuel, "NON_CLASSEE")).toBe(true);
    expect(famille.predicate(produit(), "NON_CLASSEE")).toBe(false);
    expect(famille.predicate(para, "NON_CLASSEE")).toBe(false);
  });
});

describe("la fiche stock annonce la famille dès l'en-tête", () => {
  // La fiche lit des champs que le cache hors-ligne ne porte pas.
  const serveur = (p: ProductRecord): ServerProduct =>
    ({ ...p, purchasePrice: 12, catalogueProduitId: "c1" }) as unknown as ServerProduct;
  const sheet = (categorie: string | null, local: Record<string, unknown> = {}): StockSheet =>
    ({
      catalogue: null,
      local: { categorie, ...local },
      lots: [],
      photos: [],
    }) as unknown as StockSheet;

  const renderSheet = (p: ProductRecord, s: StockSheet) =>
    renderAvecProviders(<StockDetailView product={serveur(p)} sheet={s} />);

  it("affiche la pastille Parapharmaceutique", () => {
    renderSheet(para, sheet("PARAPHARMACEUTIQUE"));
    expect(screen.getByText("Parapharmaceutique")).toBeTruthy();
  });

  it("affiche la pastille Pharmaceutique", () => {
    renderSheet(produit(), sheet("PHARMACEUTIQUE"));
    expect(screen.getByText("Pharmaceutique")).toBeTruthy();
  });

  it("sous-titre un produit para par sa marque et son rayon, pas par sa forme", () => {
    renderSheet(
      para,
      sheet("PARAPHARMACEUTIQUE", {
        marque: "Puressentiel",
        categoriePrincipale: "Aromathérapie",
        sousCategorie: "Complexes d'huiles essentielles",
      }),
    );
    expect(
      screen.getByText("Puressentiel · Aromathérapie · Complexes d'huiles essentielles"),
    ).toBeTruthy();
  });

  it("sous-titre un médicament par son dosage et sa forme", () => {
    renderSheet(produit(), sheet("PHARMACEUTIQUE"));
    expect(screen.getByText("500 mg · Comprimé")).toBeTruthy();
  });
});

/**
 * `toProductRecord` de la couche hors-ligne recopie champ par champ ce qui
 * sort d'IndexedDB : tout champ absent de cette liste blanche est
 * silencieusement perdu entre la synchro et l'écran. C'est exactement ce
 * qui aurait fait échouer `categorie` sans que `tsc` ni le build ne disent
 * rien — la liste compile parfaitement, elle est juste incomplète.
 *
 * Vérifié en exécutant l'aller-retour, et non en relisant le source : une
 * première version de ce test cherchait le nom du champ dans la fonction,
 * et laissait passer le cas où il est déstructuré puis jamais retourné —
 * précisément la faute qu'il devait attraper.
 */
describe("la couche hors-ligne ne perd pas la famille", () => {
  beforeEach(async () => {
    setOfflineSession("ph1", "user-1");
    await getDb().products.clear();
  });

  it("rend la famille telle qu'elle est arrivée du serveur", async () => {
    await getDb().products.put({
      ...para,
      pharmacyId: "ph1",
      syncStatus: "synced",
    } as unknown as LocalProduct);

    const [lu] = await listProductsHorsLigne();
    expect(lu!.categorie).toBe("PARAPHARMACEUTIQUE");
    expect(lu!.sousCategorie).toBe("Complexes d'huiles essentielles");
  });

  it("normalise en null une ligne mise en cache avant l'ajout du champ", async () => {
    const ancienneLigne: Record<string, unknown> = { ...para };
    delete ancienneLigne.categorie;
    delete ancienneLigne.sousCategorie;
    await getDb().products.put({
      ...ancienneLigne,
      pharmacyId: "ph1",
      syncStatus: "synced",
    } as unknown as LocalProduct);

    const [lu] = await listProductsHorsLigne();
    expect(lu!.categorie).toBeNull();
    expect(lu!.sousCategorie).toBeNull();
  });
});
