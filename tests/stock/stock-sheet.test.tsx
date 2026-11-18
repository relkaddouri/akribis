import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderAvecProviders } from "@/tests/fixtures/render-avec-providers";
import { StockDetailView } from "@/components/features/stock/stock-detail-view";
import { missingTvaFields, suggestedTva } from "@/lib/stock/tva";
import type { ProductRecord } from "@/lib/server/products";
import type { StockSheet } from "@/lib/server/stock-entry";

const setTva = vi.fn(async () => ({ ok: true as const }));
vi.mock("@/lib/server/stock-entry", () => ({
  setProductTva: (...args: unknown[]) => setTva(...(args as [])),
  setProductActifLocalement: vi.fn(async () => ({ ok: true as const })),
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
  renderAvecProviders(<StockDetailView product={p} sheet={s} />);

function ouvrirOnglet(nom: string) {
  const t = screen.getByRole("tab", { name: nom });
  fireEvent.mouseDown(t); fireEvent.focus(t); fireEvent.click(t);
  return screen.getByRole("tabpanel");
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

  it("n'invente aucune échéance quand rien n'est daté", () => {
    renderSheet(produit(), sheet({ lots: [lot("A", 5, null)] }));
    expect(screen.getByText(/Aucune date de péremption connue/)).toBeInTheDocument();
  });

  /**
   * Revient sur une décision antérieure — la fiche ignorait délibérément la
   * date portée par le produit, pour ne dériver la péremption que des lots.
   *
   * Elle ne tenait plus : la barre d'alertes du stock, elle, lit cette
   * date-là. Sur un produit sans lot daté, la fiche annonçait « hors
   * alertes FEFO » pendant que la liste l'affichait en alerte à huit
   * jours. Chacune avait raison de son point de vue, ce qui est la pire
   * façon de se contredire. La fiche prend donc la plus proche des deux
   * dates, et dit d'où elle vient quand aucun lot ne la porte.
   */
  it("reprend la date du produit quand aucun lot n'est daté", () => {
    renderSheet(
      produit({ nearestExpiryDate: new Date("2030-01-01") }),
      sheet({ lots: [lot("A", 5, null)] }),
    );
    expect(screen.getByText("01/01/2030")).toBeInTheDocument();
    expect(screen.getByText(/aucun lot daté/)).toBeInTheDocument();
    expect(screen.getByText(/FEFO/)).toBeInTheDocument();
  });

  it("préfère le lot quand il périme avant la date du produit", () => {
    renderSheet(
      produit({ nearestExpiryDate: new Date("2030-01-01") }),
      sheet({ lots: [lot("A", 5, new Date("2027-01-10"))] }),
    );
    expect(screen.getByText("10/01/2027")).toBeInTheDocument();
    expect(screen.queryByText(/aucun lot daté/)).not.toBeInTheDocument();
  });

  it("préfère la date du produit quand elle tombe avant celle du lot", () => {
    renderSheet(
      produit({ nearestExpiryDate: new Date("2026-09-01") }),
      sheet({ lots: [lot("A", 5, new Date("2027-01-10"))] }),
    );
    expect(screen.getByText("01/09/2026")).toBeInTheDocument();
  });

  it("affiche la valeur du stock", () => {
    // 50 unités à 18 DH — la même valeur que celle annoncée par la barre.
    renderSheet(produit(), sheet({}));
    expect(screen.getByText("900 DH")).toBeInTheDocument();
  });

  it("dit pourquoi la valeur manque quand le prix reste à zéro", () => {
    renderSheet(produit({ price: 0 }), sheet({}));
    expect(screen.getByText(/le prix de vente reste à compléter/)).toBeInTheDocument();
  });
});

const localPara = {
  categorie: "PARAPHARMACEUTIQUE", marque: "Puressentiel",
  categoriePrincipale: "Aromathérapie", sousCategorie: "Huiles essentielles",
  sousSousCategorie: null, etiquettes: "massage", prixVenteIndicatif: 152.46,
  description: "Huile de massage.", supplierNom: null, referenceInterne: null,
  localisation: null, stockMinimum: 0, prixAchat: null, conditionnement: "Roller 75ml",
  indications: null, contreIndicationConduite: null, contreIndicationAllaitement: null,
  contreIndicationGrossesse: null,
} as StockSheet["local"];

describe("fiche stock d'un produit parapharmaceutique", () => {
  it("montre marque et rayon au lieu du vocabulaire médicament", () => {
    renderSheet(produit({ remboursable: false }), sheet({ local: localPara }));
    const panneau = ouvrirOnglet("Identification");
    expect(within(panneau).getByText("Marque")).toBeInTheDocument();
    expect(within(panneau).getByText("Puressentiel")).toBeInTheDocument();
    expect(within(panneau).getByText("Rayon")).toBeInTheDocument();
    expect(within(panneau).queryByText("Forme galénique")).not.toBeInTheDocument();
  });

  it("montre le prix indicatif à la place du PPH", () => {
    // `pph: null` : sinon la section « Autres informations renseignées »
    // l'afficherait, à juste titre — c'est le sujet du test suivant.
    renderSheet(produit({ remboursable: false, pph: null }), sheet({ local: localPara }));
    const panneau = ouvrirOnglet("Prix et fiscalité");
    expect(within(panneau).getByText("Prix indicatif catalogue")).toBeInTheDocument();
    expect(within(panneau).getByText("152,46 DH")).toBeInTheDocument();
    expect(within(panneau).queryByText("PPH")).not.toBeInTheDocument();
    expect(within(panneau).getByText(/Prix libre/)).toBeInTheDocument();
  });

  it("masque posologie et contre-indications", () => {
    renderSheet(produit({ remboursable: false }), sheet({ local: localPara }));
    const panneau = ouvrirOnglet("Descriptif");
    expect(within(panneau).getByText("Huile de massage.")).toBeInTheDocument();
    expect(within(panneau).queryByText("Posologie")).not.toBeInTheDocument();
    expect(within(panneau).queryByText("Contre-indications")).not.toBeInTheDocument();
  });

  it("affiche quand même un champ hors profil s'il porte une valeur", () => {
    renderSheet(
      produit({ remboursable: false, dci: "Menthol", posologieAdulte: "2 applications" }),
      sheet({ local: localPara }),
    );
    expect(within(ouvrirOnglet("Identification")).getByText("Menthol")).toBeInTheDocument();
    expect(within(ouvrirOnglet("Descriptif")).getByText("2 applications")).toBeInTheDocument();
    // Un PPH renseigné sur un produit para reste visible plutôt qu'escamoté.
    expect(within(ouvrirOnglet("Prix et fiscalité")).getByText("PPH")).toBeInTheDocument();
  });

  it("laisse la fiche médicament intacte", () => {
    renderSheet(produit(), sheet());
    const ident = ouvrirOnglet("Identification");
    expect(within(ident).getByText("Forme galénique")).toBeInTheDocument();
    const prix = ouvrirOnglet("Prix et fiscalité");
    expect(within(prix).getByText("PPH")).toBeInTheDocument();
    expect(within(prix).getByText("Remboursement")).toBeInTheDocument();
  });

  it("garde les onglets Stock et Organisation identiques", () => {
    renderSheet(produit({ remboursable: false }), sheet({ local: localPara }));
    expect(within(ouvrirOnglet("Stock")).getByText("Quantité en stock")).toBeInTheDocument();
    expect(within(ouvrirOnglet("Organisation")).getByText("Fournisseur")).toBeInTheDocument();
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
