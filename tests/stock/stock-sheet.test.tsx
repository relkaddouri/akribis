import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StockDetailView } from "@/components/features/stock/stock-detail-view";
import { missingTvaFields, suggestedTva } from "@/lib/stock/tva";
import type { ProductRecord } from "@/lib/server/products";
import type { StockSheet } from "@/lib/server/stock-entry";

const setTva = vi.fn(async () => ({ ok: true as const }));
vi.mock("@/lib/server/stock-entry", () => ({
  setProductTva: (...args: unknown[]) => setTva(...(args as [])),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

beforeEach(() => setTva.mockClear());

function produit(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: "p1", pharmacyId: "ph1", name: "DOLIPRANE 500 mg", form: "Comprimé", dosage: "500 mg",
    laboratory: null, barcode: "6111234567893", dci: "Paracétamol", photoUrl: null,
    category: "Antalgiques", price: 18, purchasePrice: 12, pph: 12.4, tvaVente: 7, tvaAchat: 7,
    lowStockThreshold: 10, quantityInStock: 50, nearestExpiryDate: null, remboursable: true,
    baseRemboursement: 15, posologieEnfant: null, posologieAdulte: null, monographie: null,
    catalogueProduitId: "c1", createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  } as ProductRecord;
}

function sheet(overrides: Partial<StockSheet> = {}): StockSheet {
  return { catalogue: null, local: null, lots: [], photos: [], ...overrides } as StockSheet;
}

const renderSheet = (p: ProductRecord, s: StockSheet) =>
  render(<TooltipProvider><StockDetailView product={p} sheet={s} /></TooltipProvider>);

function ouvrirOnglet(nom: string) {
  const t = screen.getByRole("tab", { name: nom });
  fireEvent.mouseDown(t); fireEvent.focus(t); fireEvent.click(t);
}

describe("TVA manquante sur un produit remboursable", () => {
  it("la réclame au lieu d'afficher un tiret", () => {
    renderSheet(produit({ tvaVente: null, tvaAchat: null }), sheet());
    ouvrirOnglet("Prix et fiscalité");

    const panneau = screen.getByRole("tabpanel");
    expect(within(panneau).getAllByText("À compléter")).toHaveLength(2);
    expect(within(panneau).getAllByRole("button", { name: /Appliquer 7 %/ })).toHaveLength(2);
  });

  it("applique le taux suggéré en un clic, sans rouvrir le formulaire", () => {
    renderSheet(produit({ tvaVente: null }), sheet());
    ouvrirOnglet("Prix et fiscalité");

    fireEvent.click(within(screen.getByRole("tabpanel")).getByRole("button", { name: /Appliquer 7 %/ }));
    expect(setTva).toHaveBeenCalledWith("p1", "tvaVente", 7);
  });

  it("suggère 20 % pour de la parapharmacie", () => {
    renderSheet(produit({ tvaVente: null }), sheet({
      local: { categorie: "PARAPHARMACEUTIQUE" } as StockSheet["local"],
    }));
    ouvrirOnglet("Prix et fiscalité");
    expect(screen.getByRole("button", { name: /Appliquer 20 %/ })).toBeInTheDocument();
  });

  it("ne réclame rien sur un produit non remboursable — le tiret suffit", () => {
    renderSheet(produit({ remboursable: false, tvaVente: null, tvaAchat: null }), sheet());
    ouvrirOnglet("Prix et fiscalité");
    expect(screen.queryByText("À compléter")).not.toBeInTheDocument();
  });

  it("laisse les champs vraiment optionnels en tiret discret", () => {
    renderSheet(produit({ laboratory: null }), sheet());
    ouvrirOnglet("Identification");
    const panneau = screen.getByRole("tabpanel");
    expect(within(panneau).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(panneau).queryByText("À compléter")).not.toBeInTheDocument();
  });

  it("la règle elle-même", () => {
    expect(missingTvaFields({ remboursable: true, tvaVente: null, tvaAchat: 7 })).toEqual(["tvaVente"]);
    expect(missingTvaFields({ remboursable: false, tvaVente: null, tvaAchat: null })).toEqual([]);
    expect(missingTvaFields({ remboursable: true, tvaVente: 0, tvaAchat: 0 })).toEqual([]);
    expect(suggestedTva("PARAPHARMACEUTIQUE")).toBe(20);
    expect(suggestedTva("DISPOSITIF_MEDICAL")).toBe(20);
    expect(suggestedTva("PHARMACEUTIQUE")).toBe(7);
    expect(suggestedTva(null)).toBe(7);
  });
});

describe("prochaine péremption", () => {
  const lot = (id: string, quantite: number, datePeremption: Date | null) => ({
    id, numeroLot: id, quantite, datePeremption,
  });

  it("prend la date la plus proche parmi les lots", () => {
    renderSheet(produit(), sheet({
      lots: [lot("A", 5, new Date("2027-01-10")), lot("B", 3, new Date("2027-06-01"))],
    }));
    expect(screen.getByText("10/01/2027")).toBeInTheDocument();
  });

  it("le dit franchement quand aucun lot n'existe, avec une porte de sortie", () => {
    renderSheet(produit(), sheet({ lots: [] }));
    expect(screen.getByText("Aucun lot enregistré")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Enregistrer une réception/ })).toHaveAttribute(
      "href", "/commandes",
    );
    expect(screen.getByText("Aucun lot")).toBeInTheDocument(); // badge d'en-tête
  });

  it("signale des lots sans date plutôt que d'inventer une échéance", () => {
    renderSheet(produit(), sheet({ lots: [lot("A", 5, null)] }));
    expect(screen.getByText(/Aucun lot daté/)).toBeInTheDocument();
  });

  it("n'affiche plus de date de péremption saisie à la main", () => {
    renderSheet(produit({ nearestExpiryDate: new Date("2030-01-01") }), sheet({ lots: [] }));
    expect(screen.queryByText("01/01/2030")).not.toBeInTheDocument();
  });
});

describe("organisation en onglets", () => {
  it("porte les cinq onglets, Stock en premier", () => {
    renderSheet(produit(), sheet());
    for (const nom of ["Stock", "Identification", "Prix et fiscalité", "Organisation", "Descriptif"]) {
      expect(screen.getByRole("tab", { name: nom })).toBeInTheDocument();
    }
    expect(within(screen.getByRole("tabpanel")).getByText("Quantité en stock")).toBeInTheDocument();
  });

  it("affiche les photos du catalogue quand il y en a", () => {
    renderSheet(produit(), sheet({ photos: [{ id: "1", url: "https://s/a.jpg", ordre: 0 }] }));
    expect(document.querySelector("div.aspect-4\\/3 img")).toHaveAttribute("src", "https://s/a.jpg");
  });

  /**
   * Le repli qui manquait : un produit saisi à la main n'a pas de fiche
   * catalogue, donc pas de `photos`, mais il a bien une image téléversée
   * depuis le formulaire. Elle ne doit pas disparaître de la fiche.
   */
  it("retombe sur la photo du produit quand le catalogue n'en a aucune", () => {
    renderSheet(
      produit({ photoUrl: "https://s/produit.jpg" }),
      sheet({ photos: [] }),
    );
    expect(document.querySelector("div.aspect-4\\/3 img")).toHaveAttribute(
      "src", "https://s/produit.jpg",
    );
  });

  it("préfère les photos du catalogue à celle du produit", () => {
    renderSheet(
      produit({ photoUrl: "https://s/produit.jpg" }),
      sheet({ photos: [{ id: "1", url: "https://s/catalogue.jpg", ordre: 0 }] }),
    );
    expect(document.querySelector("div.aspect-4\\/3 img")).toHaveAttribute(
      "src", "https://s/catalogue.jpg",
    );
  });

  it("montre la tuile neutre plutôt que rien quand il n'y a aucune image", () => {
    renderSheet(produit({ photoUrl: null }), sheet({ photos: [] }));
    expect(screen.getByText("Aucune photo")).toBeInTheDocument();
    expect(document.querySelector("div.aspect-4\\/3 img")).toBeNull();
  });

  it("ne présente aucun champ comme verrouillé", () => {
    renderSheet(produit(), sheet());
    expect(screen.queryByText(/lecture seule/i)).not.toBeInTheDocument();
  });
});
