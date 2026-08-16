import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CataloguePhotoCarousel } from "@/components/features/admin/catalogue-photo-carousel";
import { CatalogueDetailView } from "@/components/features/admin/catalogue-detail-view";
import type { CatalogueProduitRecord, CataloguePhotoRecord } from "@/lib/server/catalogue";

/** La fiche porte maintenant des interrupteurs : ils appellent une action serveur. */
const setFlag = vi.fn(async () => ({ ok: true as const, id: "1" }));
vi.mock("@/lib/server/catalogue", () => ({
  setCatalogueProduitFlag: (...args: unknown[]) => setFlag(...(args as [])),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function photos(count: number): CataloguePhotoRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    url: `https://s/photo-${index}.jpg`,
    ordre: index,
  }));
}

/**
 * Radix tabs activate on focus, not on a bare click event — `fireEvent.click`
 * alone leaves the previous panel mounted. This reproduces what a real
 * pointer does: press, focus, release.
 */
function selectTab(name: string) {
  const trigger = screen.getByRole("tab", { name });
  fireEvent.mouseDown(trigger);
  fireEvent.focus(trigger);
  fireEvent.click(trigger);
  return trigger;
}

/** The <img> the viewer is currently showing (thumbnails aside). */
function grande(): HTMLImageElement | null {
  return document.querySelector<HTMLImageElement>("div.aspect-4\\/3 img");
}

function produit(overrides: Partial<CatalogueProduitRecord> = {}): CatalogueProduitRecord {
  return {
    id: "1",
    nom: "DOLIPRANE 500 mg",
    codeBarres: "6111234567893",
    dosage: "500 mg",
    categorie: "PHARMACEUTIQUE",
    classeTherapeutique: "Antalgiques",
    formeGalenique: "Comprimé pelliculé",
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
    posologieAdulte: "1 comprimé, 3 fois par jour",
    posologieEnfant: null,
    indications: null,
    contreIndicationConduite: null,
    contreIndicationAllaitement: null,
    contreIndicationGrossesse: null,
    referenceLabo: null,
    conditionnement: "Boîte de 16",
    monographie: null,
    photos: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  } as CatalogueProduitRecord;
}

describe("navigation dans le carrousel", () => {
  it("avance, revient, et boucle aux deux extrémités", () => {
    render(<CataloguePhotoCarousel photos={photos(4)} alt="Doliprane" />);

    expect(grande()).toHaveAttribute("src", "https://s/photo-0.jpg");
    expect(screen.getByText("1/4")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Photo suivante"));
    expect(grande()).toHaveAttribute("src", "https://s/photo-1.jpg");
    expect(screen.getByText("2/4")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Photo précédente"));
    expect(grande()).toHaveAttribute("src", "https://s/photo-0.jpg");
    expect(screen.getByText("1/4")).toBeInTheDocument();

    // Depuis la première, « précédent » va à la dernière plutôt que nulle part.
    fireEvent.click(screen.getByLabelText("Photo précédente"));
    expect(grande()).toHaveAttribute("src", "https://s/photo-3.jpg");
    expect(screen.getByText("4/4")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Photo suivante"));
    expect(grande()).toHaveAttribute("src", "https://s/photo-0.jpg");
  });

  it("saute directement à la photo dont on clique la miniature", () => {
    render(<CataloguePhotoCarousel photos={photos(4)} alt="Doliprane" />);

    fireEvent.click(screen.getByLabelText("Voir la photo 3"));
    expect(grande()).toHaveAttribute("src", "https://s/photo-2.jpg");
    expect(screen.getByText("3/4")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Voir la photo 1"));
    expect(grande()).toHaveAttribute("src", "https://s/photo-0.jpg");
  });

  it("marque la miniature courante, et elle seule", () => {
    render(<CataloguePhotoCarousel photos={photos(3)} alt="Doliprane" />);

    const courante = () =>
      screen.getAllByRole("button").filter((button) => button.getAttribute("aria-current") === "true");

    expect(courante()).toHaveLength(1);
    expect(courante()[0]).toHaveAccessibleName("Voir la photo 1");

    fireEvent.click(screen.getByLabelText("Voir la photo 2"));
    expect(courante()).toHaveLength(1);
    expect(courante()[0]).toHaveAccessibleName("Voir la photo 2");
  });

  it("n'affiche aucun contrôle inutile pour une seule photo", () => {
    render(<CataloguePhotoCarousel photos={photos(1)} alt="Doliprane" />);

    expect(grande()).toHaveAttribute("src", "https://s/photo-0.jpg");
    expect(screen.queryByLabelText("Photo suivante")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Photo précédente")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Voir la photo 1")).not.toBeInTheDocument();
    expect(screen.queryByText("1/1")).not.toBeInTheDocument();
  });

  it("retombe sur la tuile neutre si une photo ne charge pas, sans bloquer la navigation", () => {
    render(<CataloguePhotoCarousel photos={photos(3)} alt="Doliprane" />);

    fireEvent.error(grande()!);
    expect(screen.getAllByText("Aucune photo").length).toBeGreaterThan(0);

    // Les flèches marchent toujours : on peut passer à une photo saine.
    fireEvent.click(screen.getByLabelText("Photo suivante"));
    expect(grande()).toHaveAttribute("src", "https://s/photo-1.jpg");
  });
});

describe("fiche d'un produit sans aucune photo", () => {
  it("reste entièrement utilisable", () => {
    render(<CatalogueDetailView produit={produit({ photos: [] })} />);

    // Le visuel de remplacement, pas une image cassée ni une erreur.
    expect(screen.getByText("Aucune photo")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();

    // L'identité et les onglets sont là.
    expect(screen.getByRole("heading", { name: "DOLIPRANE 500 mg" })).toBeInTheDocument();
    expect(screen.getByText("500 mg · Comprimé pelliculé")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Identification" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Prix et fiscalité" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Descriptif" })).toBeInTheDocument();
  });

  it("laisse naviguer entre les onglets", () => {
    render(<CatalogueDetailView produit={produit({ photos: [] })} />);

    const identification = screen.getByRole("tabpanel");
    expect(within(identification).getByText("Classe thérapeutique")).toBeInTheDocument();

    selectTab("Prix et fiscalité");
    expect(within(screen.getByRole("tabpanel")).getByText("12,40 DH")).toBeInTheDocument();

    selectTab("Descriptif");
    expect(
      within(screen.getByRole("tabpanel")).getByText("1 comprimé, 3 fois par jour"),
    ).toBeInTheDocument();
  });

  it("affiche un tiret sur les champs vides plutôt que de les masquer", () => {
    render(<CatalogueDetailView produit={produit({ photos: [], gamme: null, dci: null })} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("porte l'interrupteur d'activation en en-tête, hors des onglets", () => {
    setFlag.mockClear();
    render(<CatalogueDetailView produit={produit({ photos: [] })} />);

    // Visible sans cliquer : il n'est pas dans un panneau d'onglet.
    const bascule = screen.getByRole("switch", { name: /Désactiver DOLIPRANE/ });
    expect(bascule).toBeChecked();
    expect(bascule.closest('[role="tabpanel"]')).toBeNull();
    expect(screen.getByText("Actif")).toBeInTheDocument();

    fireEvent.click(bascule);
    expect(setFlag).not.toHaveBeenCalled(); // la confirmation d'abord

    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Désactiver" }));
    expect(setFlag).toHaveBeenCalledWith("1", "actifCatalogue", false);
  });

  it("n'expose qu'un seul interrupteur d'activation", () => {
    render(<CatalogueDetailView produit={produit({ photos: [] })} />);
    expect(screen.getAllByRole("switch", { name: /DOLIPRANE/ })).toHaveLength(1);
  });

  it("signale une fiche à classer et une fiche inactive", () => {
    render(<CatalogueDetailView produit={produit({ photos: [], categorie: null, actifCatalogue: false })} />);
    expect(screen.getByText("À classer")).toBeInTheDocument();
    expect(screen.getByText("Inactif")).toBeInTheDocument();
  });

  it("ne casse pas si la relation photos n'a pas été chargée", () => {
    const sansRelation = { ...produit(), photos: undefined } as unknown as CatalogueProduitRecord;
    render(<CatalogueDetailView produit={sansRelation} />);
    expect(screen.getByText("Aucune photo")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "DOLIPRANE 500 mg" })).toBeInTheDocument();
  });
});

describe("fiche avec photos", () => {
  it("montre la photo principale d'abord et les miniatures", () => {
    render(<CatalogueDetailView produit={produit({ photos: photos(3) })} />);

    expect(grande()).toHaveAttribute("src", "https://s/photo-0.jpg");
    expect(screen.getByText("1/3")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Voir la photo/)).toHaveLength(3);
  });

  it("porte les repères qu'un pharmacien lit en premier", () => {
    render(
      <CatalogueDetailView
        produit={produit({ photos: [], necessitePrescription: true, refrigerationRequise: true })}
      />,
    );
    expect(screen.getByText("Sur ordonnance")).toBeInTheDocument();
    expect(screen.getByText("Conservation au froid")).toBeInTheDocument();
    expect(screen.getByText("Remboursable")).toBeInTheDocument();
  });
});
