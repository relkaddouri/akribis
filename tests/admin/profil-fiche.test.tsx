import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CatalogueDetailView } from "@/components/features/admin/catalogue-detail-view";
import { profilDe, estRenseigne } from "@/lib/catalogue/profil-fiche";
import type { CatalogueProduitRecord } from "@/lib/server/catalogue";

vi.mock("@/lib/server/catalogue", () => ({
  setCatalogueProduitFlag: async () => ({ ok: true as const, id: "1" }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

function fiche(o: Partial<CatalogueProduitRecord> = {}): CatalogueProduitRecord {
  return {
    id: "1", nom: "PRODUIT", codeBarres: null, dosage: null, categorie: "PHARMACEUTIQUE",
    classeTherapeutique: null, formeGalenique: "Comprimé", dci: null, laboratoire: null,
    produitTableau: "AUCUN", gamme: null, sousGamme: null, necessitePrescription: false,
    produitCommercialise: true, groupeProduits: null, actifCatalogue: true,
    refrigerationRequise: false, marque: null, categoriePrincipale: null, sousCategorie: null,
    sousSousCategorie: null, etiquettes: null, pph: null, ppv: null, prixBaseRemboursement: null,
    tvaAchat: null, tvaVente: null, remboursable: false, tauxRemboursement: null,
    prixVenteIndicatif: null, description: null, excipients: null, posologieAdulte: null,
    posologieEnfant: null, indications: null, contreIndicationConduite: null,
    contreIndicationAllaitement: null, contreIndicationGrossesse: null, referenceLabo: null,
    conditionnement: null, monographie: null, photos: [],
    createdAt: new Date(), updatedAt: new Date(), ...o,
  } as CatalogueProduitRecord;
}

const para = (o: Partial<CatalogueProduitRecord> = {}) =>
  fiche({ categorie: "PARAPHARMACEUTIQUE", marque: "Puressentiel",
          categoriePrincipale: "Aromathérapie", sousCategorie: "Complexes d'huiles essentielles",
          etiquettes: "huiles, massage", prixVenteIndicatif: 152.46, ...o });

function onglet(nom: string) {
  const t = screen.getByRole("tab", { name: nom });
  fireEvent.mouseDown(t); fireEvent.focus(t); fireEvent.click(t);
  return screen.getByRole("tabpanel");
}

describe("choix du profil", () => {
  it("range para et dispositif du même côté, le reste en médicament", () => {
    expect(profilDe("PARAPHARMACEUTIQUE")).toBe("parapharmacie");
    expect(profilDe("DISPOSITIF_MEDICAL")).toBe("parapharmacie");
    expect(profilDe("PHARMACEUTIQUE")).toBe("medicament");
    expect(profilDe(null)).toBe("medicament");
    expect(profilDe("INCONNU")).toBe("medicament");
  });

  it("ne considère pas une chaîne vide comme renseignée", () => {
    expect(estRenseigne("")).toBe(false);
    expect(estRenseigne("   ")).toBe(false);
    expect(estRenseigne(null)).toBe(false);
    expect(estRenseigne(false)).toBe(false);
    expect(estRenseigne("x")).toBe(true);
    expect(estRenseigne(0)).toBe(true);
  });
});

describe("fiche parapharmaceutique", () => {
  it("montre marque, rayon et étiquettes", () => {
    render(<CatalogueDetailView produit={para()} />);
    const panneau = onglet("Identification");
    expect(within(panneau).getByText("Marque")).toBeInTheDocument();
    expect(within(panneau).getByText("Puressentiel")).toBeInTheDocument();
    expect(within(panneau).getByText("Rayon")).toBeInTheDocument();
    expect(within(panneau).getByText("Aromathérapie")).toBeInTheDocument();
    expect(within(panneau).getByText("Complexes d'huiles essentielles")).toBeInTheDocument();
    expect(within(panneau).getByText("huiles, massage")).toBeInTheDocument();
  });

  it("n'affiche pas le vocabulaire du médicament quand il est vide", () => {
    render(<CatalogueDetailView produit={para()} />);
    const panneau = onglet("Identification");
    expect(within(panneau).queryByText("DCI")).not.toBeInTheDocument();
    expect(within(panneau).queryByText("Tableau")).not.toBeInTheDocument();
    expect(within(panneau).queryByText("Forme galénique")).not.toBeInTheDocument();
  });

  it("montre le prix indicatif, pas le PPV réglementé", () => {
    render(<CatalogueDetailView produit={para()} />);
    const panneau = onglet("Prix et fiscalité");
    expect(within(panneau).getByText("Prix de vente indicatif")).toBeInTheDocument();
    expect(within(panneau).getByText("152,46 DH")).toBeInTheDocument();
    expect(within(panneau).queryByText("PPV")).not.toBeInTheDocument();
    expect(within(panneau).getByText(/pas de prix réglementé/)).toBeInTheDocument();
  });

  it("masque posologie et contre-indications, sans objet ici", () => {
    render(<CatalogueDetailView produit={para()} />);
    const panneau = onglet("Descriptif");
    expect(within(panneau).queryByText("Posologie")).not.toBeInTheDocument();
    expect(within(panneau).queryByText("Contre-indications")).not.toBeInTheDocument();
  });

  /** La garantie qui compte : rien de rempli ne disparaît. */
  it("affiche quand même un champ hors profil s'il porte une valeur", () => {
    render(<CatalogueDetailView produit={para({ dci: "Menthol", ppv: 200 })} />);
    expect(within(onglet("Identification")).getByText("Menthol")).toBeInTheDocument();
    expect(within(onglet("Prix et fiscalité")).getByText("200,00 DH")).toBeInTheDocument();
  });

  it("affiche une posologie renseignée malgré le profil", () => {
    render(<CatalogueDetailView produit={para({ posologieAdulte: "2 applications" })} />);
    expect(within(onglet("Descriptif")).getByText("2 applications")).toBeInTheDocument();
  });
});

describe("fiche médicament, inchangée", () => {
  it("garde DCI, tableau, PPV et remboursement", () => {
    render(<CatalogueDetailView produit={fiche({ dci: "Paracétamol", ppv: 18 })} />);
    const ident = onglet("Identification");
    expect(within(ident).getByText("DCI")).toBeInTheDocument();
    expect(within(ident).getByText("Tableau")).toBeInTheDocument();
    const prix = onglet("Prix et fiscalité");
    expect(within(prix).getByText("PPV")).toBeInTheDocument();
    expect(within(prix).getByText("Remboursable")).toBeInTheDocument();
  });

  it("garde posologie et contre-indications même vides", () => {
    render(<CatalogueDetailView produit={fiche()} />);
    const panneau = onglet("Descriptif");
    expect(within(panneau).getByText("Posologie")).toBeInTheDocument();
    expect(within(panneau).getByText("Contre-indications")).toBeInTheDocument();
  });
});
