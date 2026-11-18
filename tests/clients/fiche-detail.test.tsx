import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderAvecProviders } from "@/tests/fixtures/render-avec-providers";
import { ClientDetailsSections } from "@/components/features/clients/client-details-sections";
import { ClientBalanceCard } from "@/components/features/clients/client-balance-card";
import type { ClientRecord } from "@/lib/server/clients";

/**
 * La fiche en **consultation**, pas le formulaire d'édition.
 *
 * La distinction n'est pas de forme : avant ce module, le CIN, l'adresse
 * et l'affiliation n'existaient que dans le formulaire. Ouvrir la fiche
 * d'un client ne les montrait pas — il fallait cliquer « Modifier » pour
 * lire une donnée qu'on ne voulait pas changer.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

function fiche(surcharges: Partial<ClientRecord> = {}): ClientRecord {
  return {
    id: "cli-1",
    pharmacyId: "pharm-1",
    name: "Fatima Bennani",
    phone: "0600112233",
    email: "fatima@example.ma",
    typeClient: "regulier",
    cin: "AB123456",
    medecinTraitant: "Dr Alami",
    adresse: "12 rue des Consuls",
    codePostal: "10000",
    ville: "Rabat",
    pays: "Maroc",
    numeroImmatriculation: "CNSS-778899",
    insurerId: "org-1",
    plafondCredit: 1000,
    solde: -300,
    pointsFidelite: 12,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...surcharges,
  } as ClientRecord;
}

/**
 * « Adresse » est à la fois un titre de section et un libellé de champ à
 * l'intérieur : on vise le titre de carte, sinon la recherche remonte
 * deux éléments et le test échoue pour une raison qui n'est pas la sienne.
 */
function titreDeSection(titre: string): HTMLElement {
  const trouve = screen
    .getAllByText(titre)
    .find((element) => element.closest("[data-slot='card-title']") !== null);
  if (!trouve) throw new Error(`Section « ${titre} » introuvable`);
  return trouve;
}

function section(titre: string): HTMLElement {
  return titreDeSection(titre).closest("[data-slot='card']") as HTMLElement;
}

describe("sections de la fiche en consultation", () => {
  it("affiche les trois sections attendues", () => {
    renderAvecProviders(<ClientDetailsSections client={fiche()} organismeNom="CNSS" />);

    expect(titreDeSection("Identité")).toBeInTheDocument();
    expect(titreDeSection("Adresse")).toBeInTheDocument();
    expect(titreDeSection("Tiers payant")).toBeInTheDocument();
  });

  it("montre l'identité, CIN et médecin traitant compris", () => {
    renderAvecProviders(<ClientDetailsSections client={fiche()} organismeNom="CNSS" />);
    const identite = within(section("Identité"));

    expect(identite.getByText("AB123456")).toBeInTheDocument();
    expect(identite.getByText("Dr Alami")).toBeInTheDocument();
    expect(identite.getByText("fatima@example.ma")).toBeInTheDocument();
    expect(identite.getByText("Régulier")).toBeInTheDocument();
  });

  it("montre l'adresse complète", () => {
    renderAvecProviders(<ClientDetailsSections client={fiche()} organismeNom="CNSS" />);
    const adresse = within(section("Adresse"));

    expect(adresse.getByText("12 rue des Consuls")).toBeInTheDocument();
    expect(adresse.getByText("10000")).toBeInTheDocument();
    expect(adresse.getByText("Rabat")).toBeInTheDocument();
    expect(adresse.getByText("Maroc")).toBeInTheDocument();
  });

  it("montre l'organisme par son nom, pas par son identifiant", () => {
    // Un `insurer_id` en UUID à l'écran ne dit rien au pharmacien, et
    // c'est précisément ce qu'on évite en liant une table plutôt qu'en
    // recopiant « CNSS » à la main sur chaque fiche.
    renderAvecProviders(<ClientDetailsSections client={fiche()} organismeNom="CNSS" />);
    const tiersPayant = within(section("Tiers payant"));

    expect(tiersPayant.getByText("CNSS")).toBeInTheDocument();
    expect(tiersPayant.getByText("CNSS-778899")).toBeInTheDocument();
    expect(tiersPayant.queryByText("org-1")).toBeNull();
  });

  it("écrit « Non renseigné » plutôt que d'inventer une valeur", () => {
    renderAvecProviders(
      <ClientDetailsSections
        client={fiche({ cin: null, medecinTraitant: null, ville: null })}
        organismeNom={null}
      />,
    );

    // Quatre champs vides : CIN, médecin traitant, ville, organisme. La
    // ligne reste, pour que le pharmacien voie que la donnée manque
    // plutôt que de chercher où elle est passée.
    expect(screen.getAllByText("Non renseigné")).toHaveLength(4);
  });
});

describe("plafond de crédit à côté du solde", () => {
  it("affiche le plafond et la marge encore disponible", () => {
    // « en un coup d'œil la marge encore disponible » : doit 300 sur un
    // plafond de 1000, il reste 700.
    renderAvecProviders(
      <ClientBalanceCard clientId="cli-1" solde={-300} points={12} plafondCredit={1000} />,
    );

    expect(screen.getByText(/Plafond/)).toHaveTextContent("1 000,00");
    expect(screen.getByText(/encore disponibles/)).toHaveTextContent("700,00");
  });

  it("le dit quand le plafond est atteint, sans afficher une marge négative", () => {
    renderAvecProviders(
      <ClientBalanceCard clientId="cli-1" solde={-1200} points={0} plafondCredit={1000} />,
    );

    expect(screen.getByText(/plafond atteint/)).toBeInTheDocument();
    expect(screen.queryByText(/-200|−200/)).toBeNull();
  });

  it("le dit aussi quand aucun plafond n'est fixé", () => {
    renderAvecProviders(
      <ClientBalanceCard clientId="cli-1" solde={-300} points={0} plafondCredit={null} />,
    );

    expect(screen.getByText("Aucun plafond de crédit fixé")).toBeInTheDocument();
  });
});
