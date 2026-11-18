import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderAvecProviders } from "@/tests/fixtures/render-avec-providers";
import { prixAComplete, prixInitial, prixSuggere } from "@/lib/stock/prix";
import { ProductTable } from "@/components/features/stock/product-table";
import { StockDetailView } from "@/components/features/stock/stock-detail-view";
import type { ProductRecord } from "@/lib/offline/products";
import type { ProductRecord as ServerProduct } from "@/lib/server/products";
import type { StockSheet } from "@/lib/server/stock-entry";

/**
 * Un produit du stock à 0,00 DH passe en caisse et rapporte zéro dirham,
 * à chaque vente, sans que rien n'attire l'œil : « 0.00 » se lit comme un
 * prix.
 *
 * La cause était `price: fiche.ppv ?? 0` à l'ajout au stock. Le PPV est le
 * prix public réglementé, et seules les fiches de médicament en portent
 * un — toute la parapharmacie entrait donc gratuite, alors que sa fiche
 * porte bel et bien un prix indicatif.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/server/stock-entry", () => ({
  setProductPrix: vi.fn(async () => ({ ok: true as const })),
  setProductTva: vi.fn(async () => ({ ok: true as const })),
  setProductActifLocalement: vi.fn(async () => ({ ok: true as const })),
}));

describe("quel prix un produit reçoit en entrant au stock", () => {
  it("prend le PPV quand la fiche en a un", () => {
    expect(prixInitial({ ppv: 18.5, prixVenteIndicatif: 25 })).toBe(18.5);
  });

  it("retombe sur le prix indicatif quand le PPV manque", () => {
    // Le cas de toute la parapharmacie : pas de PPV, mais un prix.
    expect(prixInitial({ ppv: null, prixVenteIndicatif: 188.1 })).toBe(188.1);
  });

  it("ne vaut zéro que si la fiche n'a réellement aucun prix", () => {
    expect(prixInitial({ ppv: null, prixVenteIndicatif: null })).toBe(0);
  });
});

describe("quand réclamer un prix", () => {
  it("réclame un prix nul, absent ou négatif", () => {
    expect(prixAComplete(0)).toBe(true);
    expect(prixAComplete(null)).toBe(true);
    expect(prixAComplete(-1)).toBe(true);
  });

  it("ne réclame rien sur un vrai prix", () => {
    expect(prixAComplete(18.5)).toBe(false);
    expect(prixAComplete(0.5)).toBe(false);
  });

  it("suggère le PPV en priorité, puis l'indicatif", () => {
    expect(prixSuggere({ ppv: 18.5, prixVenteIndicatif: 25 })?.montant).toBe(18.5);
    expect(prixSuggere({ ppv: null, prixVenteIndicatif: 188.1 })?.montant).toBe(188.1);
  });

  it("ne suggère rien plutôt qu'un chiffre inventé", () => {
    expect(prixSuggere({ ppv: null, prixVenteIndicatif: null })).toBeNull();
    // Un zéro au catalogue n'est pas davantage un prix qu'un zéro au stock.
    expect(prixSuggere({ ppv: 0, prixVenteIndicatif: 0 })).toBeNull();
  });
});

function produit(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: "p1",
    pharmacyId: "ph1",
    name: "Puressentiel Articulations",
    form: "Spray",
    dosage: null,
    laboratory: null,
    barcode: null,
    dci: null,
    photoUrl: null,
    category: null,
    categorie: "PARAPHARMACEUTIQUE",
    sousCategorie: "Complexes d'huiles essentielles",
    actifLocalement: true,
    price: 0,
    pph: null,
    tvaVente: 20,
    tvaAchat: 20,
    lowStockThreshold: 10,
    quantityInStock: 120,
    nearestExpiryDate: null,
    remboursable: false,
    baseRemboursement: null,
    posologieEnfant: null,
    posologieAdulte: null,
    monographie: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ProductRecord;
}

describe("la liste du stock", () => {
  const renderTable = (products: ProductRecord[]) =>
    renderAvecProviders(
      <ProductTable products={products} isLoading={false} search="" onSearchChange={() => {}} />,
    );
  const ligne = (nom: string) => screen.getByText(nom).closest("tr")!;

  it("réclame le prix au lieu d'afficher « 0.00 »", () => {
    renderTable([produit()]);
    expect(within(ligne("Puressentiel Articulations")).getByText("À compléter")).toBeTruthy();
    expect(within(ligne("Puressentiel Articulations")).queryByText("0.00")).toBeNull();
  });

  it("affiche normalement un vrai prix", () => {
    renderTable([produit({ name: "DOLIPRANE", price: 18.5 })]);
    expect(within(ligne("DOLIPRANE")).getByText("18.50")).toBeTruthy();
    expect(within(ligne("DOLIPRANE")).queryByText("À compléter")).toBeNull();
  });
});

describe("la fiche produit", () => {
  /** Radix active un onglet au focus, pas au clic — d'où les trois événements. */
  function ouvrirPrix() {
    const onglet = screen.getByRole("tab", { name: "Prix et fiscalité" });
    fireEvent.mouseDown(onglet);
    fireEvent.focus(onglet);
    fireEvent.click(onglet);
    return screen.getByRole("tabpanel");
  }

  const serveur = (p: ProductRecord): ServerProduct =>
    ({ ...p, purchasePrice: null, catalogueProduitId: "c1" }) as unknown as ServerProduct;

  const sheet = (local: Record<string, unknown> = {}, catalogue: Record<string, unknown> | null = null) =>
    ({
      catalogue,
      local: { categorie: "PARAPHARMACEUTIQUE", ...local },
      lots: [],
      photos: [],
    }) as unknown as StockSheet;

  it("propose d'appliquer le prix indicatif du catalogue", () => {
    renderAvecProviders(
      <StockDetailView product={serveur(produit())} sheet={sheet({ prixVenteIndicatif: 188.1 })} />,
    );
    const prix = ouvrirPrix();
    expect(within(prix).getByText("À compléter")).toBeTruthy();
    expect(within(prix).getByRole("button", { name: /Appliquer 188,10 DH/ })).toBeTruthy();
    expect(within(prix).getByText("Prix indicatif du catalogue")).toBeTruthy();
  });

  it("préfère le PPV quand le catalogue en a un", () => {
    renderAvecProviders(
      <StockDetailView
        product={serveur(produit())}
        sheet={sheet({ prixVenteIndicatif: 188.1 }, { ppv: 150 })}
      />,
    );
    expect(within(ouvrirPrix()).getByRole("button", { name: /Appliquer 150,00 DH/ })).toBeTruthy();
  });

  it("réclame sans bouton quand le catalogue n'a aucun prix à proposer", () => {
    renderAvecProviders(
      <StockDetailView product={serveur(produit())} sheet={sheet({ prixVenteIndicatif: null })} />,
    );
    const prix = ouvrirPrix();
    expect(within(prix).getByText("À compléter")).toBeTruthy();
    expect(within(prix).queryByRole("button", { name: /Appliquer/ })).toBeNull();
  });

  it("ne réclame rien quand le prix est renseigné", () => {
    renderAvecProviders(
      <StockDetailView
        // Prix de vente distinct de l'indicatif : sinon les deux lignes
        // portent le même montant et l'assertion ne prouve plus laquelle
        // est laquelle.
        product={serveur(produit({ price: 200 }))}
        sheet={sheet({ prixVenteIndicatif: 188.1 })}
      />,
    );
    const prix = ouvrirPrix();
    expect(within(prix).queryByText("À compléter")).toBeNull();
    expect(within(prix).getByText("200,00 DH")).toBeTruthy();
  });
});

/**
 * L'ajout au stock ne peut pas se tester ici sans un faux Prisma complet
 * (transaction, upsert, mouvement, lot). On vérifie donc que la création
 * passe bien par `prixInitial`, dont le comportement est couvert plus
 * haut — ce qui suffit à empêcher le retour de `fiche.ppv ?? 0`.
 */
describe("l'ajout au stock utilise bien la règle de prix", () => {
  it("ne retombe plus directement sur le PPV", () => {
    const src = readFileSync(
      resolve(__dirname, "../..", "lib/server/stock-entry.ts"),
      "utf8",
    );
    const creation = /tx\.product\.create\(\{[\s\S]*?\n {8}\}\);/.exec(src);
    expect(creation, "création du produit introuvable").toBeTruthy();

    expect(
      /price: prixInitial\(fiche\)/.test(creation![0]),
      "La création doit passer par prixInitial : sans lui, toute fiche sans " +
        "PPV — c'est-à-dire toute la parapharmacie — entre au stock à 0,00 DH.",
    ).toBe(true);
    expect(creation![0]).not.toMatch(/price: fiche\.ppv/);
  });
});
