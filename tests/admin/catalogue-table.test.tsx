import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CatalogueTable } from "@/components/features/admin/catalogue-table";
import type { CatalogueProduitRecord } from "@/lib/server/catalogue";

/**
 * The server module is a "use server" file: importing it for real would
 * drag Prisma into jsdom. Only the action the table calls is needed.
 */
const setFlag = vi.fn(async () => ({ ok: true as const, id: "1" }));
vi.mock("@/lib/server/catalogue", () => ({
  setCatalogueProduitFlag: (...args: unknown[]) => setFlag(...(args as [])),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

/**
 * The table's row actions are Radix tooltips, which throw without a
 * provider above them. In the app that provider comes from the admin
 * layout — on the pharmacy side it lives inside the sidebar, which the
 * back-office has no equivalent of, and forgetting it made the whole
 * catalogue page crash on first render.
 */
function renderTable(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function produit(overrides: Partial<CatalogueProduitRecord> = {}): CatalogueProduitRecord {
  return {
    id: "1",
    nom: "DOLIPRANE 500 mg",
    codeBarres: "6111234567893",
    dosage: "500 mg",
    photoUrl: null,
    categorie: "PHARMACEUTIQUE",
    classeTherapeutique: "Antalgiques",
    formeGalenique: "Comprimé",
    dci: "Paracétamol",
    laboratoire: "Sanofi",
    produitTableau: "AUCUN",
    gamme: null,
    sousGamme: null,
    necessitePrescription: false,
    produitCommercialise: true,
    groupeProduits: null,
    actifCatalogue: true,
    refrigerationRequise: false,
    pph: 12.4,
    ppv: 18,
    prixBaseRemboursement: 15,
    tvaAchat: 7,
    tvaVente: 7,
    remboursable: true,
    tauxRemboursement: 70,
    description: null,
    excipients: null,
    posologieAdulte: null,
    posologieEnfant: null,
    indications: null,
    contreIndicationConduite: null,
    contreIndicationAllaitement: null,
    contreIndicationGrossesse: null,
    referenceLabo: null,
    conditionnement: null,
    monographie: null,
    photos: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  } as CatalogueProduitRecord;
}

describe("tableau du catalogue", () => {
  it("affiche une fiche avec son prix et son statut", () => {
    renderTable(<CatalogueTable produits={[produit()]} />);

    expect(screen.getByText("DOLIPRANE 500 mg")).toBeInTheDocument();
    expect(screen.getByText("6111234567893")).toBeInTheDocument();
    expect(screen.getByText("Paracétamol")).toBeInTheDocument();
    expect(screen.getByText("18,00 DH")).toBeInTheDocument();
    expect(screen.getByText("Actif")).toBeInTheDocument();
  });

  it("signale les fiches à compléter plutôt que d'afficher un vide", () => {
    renderTable(<CatalogueTable produits={[produit({ categorie: null, codeBarres: null })]} />);
    expect(screen.getByText("À classer")).toBeInTheDocument();
    expect(screen.getByText("Absent")).toBeInTheDocument();
  });

  it("montre un catalogue vide sans casser", () => {
    renderTable(<CatalogueTable produits={[]} />);
    expect(screen.getByText("Catalogue vide")).toBeInTheDocument();
  });

  /**
   * Le point 4 du cahier des charges : jamais de suppression. L'interrupteur
   * doit demander confirmation, et l'action appelée doit être une bascule
   * de statut — pas une suppression.
   */
  it("demande confirmation avant de désactiver, et désactive sans supprimer", async () => {
    setFlag.mockClear();
    renderTable(<CatalogueTable produits={[produit()]} />);

    const bascule = screen.getByRole("switch", { name: /Désactiver DOLIPRANE/ });
    expect(bascule).toBeChecked();
    fireEvent.click(bascule);

    // Rien n'est parti tant que la confirmation n'est pas donnée.
    expect(setFlag).not.toHaveBeenCalled();

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/rien n'est\s+supprimé/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Désactiver" }));
    expect(setFlag).toHaveBeenCalledWith("1", "actifCatalogue", false);
  });

  it("laisse annuler sans rien changer", async () => {
    setFlag.mockClear();
    renderTable(<CatalogueTable produits={[produit()]} />);

    fireEvent.click(screen.getByRole("switch", { name: /Désactiver DOLIPRANE/ }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Annuler" }));

    expect(setFlag).not.toHaveBeenCalled();
    // L'interrupteur n'a pas bougé : son état vient de la donnée, pas du clic.
    expect(screen.getByRole("switch", { name: /Désactiver DOLIPRANE/ })).toBeChecked();
  });

  it("réactive, également sous confirmation", async () => {
    setFlag.mockClear();
    renderTable(<CatalogueTable produits={[produit({ actifCatalogue: false })]} />);

    const bascule = screen.getByRole("switch", { name: /Réactiver DOLIPRANE/ });
    expect(bascule).not.toBeChecked();
    fireEvent.click(bascule);

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/réapparaîtra/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Réactiver" }));
    expect(setFlag).toHaveBeenCalledWith("1", "actifCatalogue", true);
  });

  it("filtre et recherche sans recharger la page", async () => {
    renderTable(
      <CatalogueTable
        produits={[
          produit(),
          produit({ id: "2", nom: "AMOXICILLINE 1 g", dci: "Amoxicilline", codeBarres: "6111111111111" }),
        ]}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/Nom, code-barres/), { target: { value: "amoxi" } });
    expect(screen.getByText("AMOXICILLINE 1 g")).toBeInTheDocument();
    expect(screen.queryByText("DOLIPRANE 500 mg")).not.toBeInTheDocument();
  });
});
