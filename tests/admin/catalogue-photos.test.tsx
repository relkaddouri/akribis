import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CatalogueTable } from "@/components/features/admin/catalogue-table";
import { CataloguePhotoField } from "@/components/features/admin/catalogue-wizard/photo-field";
import {
  MAX_CATALOGUE_PHOTOS,
  MAX_CATALOGUE_PHOTO_SIZE_BYTES,
  moveItem,
  principalPhoto,
  rejectionReason,
  renumber,
} from "@/lib/catalogue/photo-rules";
import type { CatalogueProduitRecord } from "@/lib/server/catalogue";

vi.mock("@/lib/server/catalogue", () => ({
  setCatalogueProduitActif: async () => ({ ok: true as const, id: "1" }),
}));
vi.mock("@/lib/server/catalogue-photo", () => ({
  uploadCataloguePhotos: async () => ({ ok: true as const, photos: [], rejets: [] }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function renderIn(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function photo(url: string, ordre: number, dateAjout = "2026-01-01") {
  return { id: url, url, ordre, dateAjout };
}

function produit(overrides: Partial<CatalogueProduitRecord> = {}): CatalogueProduitRecord {
  return {
    id: "1",
    nom: "DOLIPRANE 500 mg",
    codeBarres: "6111234567893",
    dosage: "500 mg",
    categorie: "PHARMACEUTIQUE",
    classeTherapeutique: null,
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
    pph: null,
    ppv: 18,
    prixBaseRemboursement: null,
    tvaAchat: null,
    tvaVente: null,
    remboursable: false,
    tauxRemboursement: null,
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

describe("supprimer une photo n'affecte pas les autres", () => {
  const TROIS = ["https://s/a.jpg", "https://s/b.jpg", "https://s/c.jpg"];

  it("retire uniquement celle qu'on vise, dans l'ordre et sans toucher au reste", () => {
    const onChange = vi.fn();
    renderIn(<CataloguePhotoField value={TROIS} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText("Supprimer la photo 2"));

    expect(onChange).toHaveBeenCalledWith(["https://s/a.jpg", "https://s/c.jpg"]);
  });

  it("promeut la suivante quand c'est la principale qu'on supprime", () => {
    const onChange = vi.fn();
    renderIn(<CataloguePhotoField value={TROIS} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText("Supprimer la photo 1"));

    const [restantes] = onChange.mock.calls[0]!;
    expect(restantes).toEqual(["https://s/b.jpg", "https://s/c.jpg"]);
    // b devient la photo principale par sa seule position dans la liste.
    expect(renumber(restantes)).toEqual([
      { url: "https://s/b.jpg", ordre: 0 },
      { url: "https://s/c.jpg", ordre: 1 },
    ]);
  });

  it("renumérote sans laisser de trou après une suppression au milieu", () => {
    const apres = TROIS.filter((_, index) => index !== 1);
    expect(renumber(apres).map((photo) => photo.ordre)).toEqual([0, 1]);
  });

  it("supprimer la dernière photo laisse une liste vide, pas une erreur", () => {
    const onChange = vi.fn();
    renderIn(<CataloguePhotoField value={["https://s/seule.jpg"]} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText("Supprimer la photo 1"));
    expect(onChange).toHaveBeenCalledWith([]);
    expect(renumber([])).toEqual([]);
  });
});

describe("un produit sans photo s'affiche normalement", () => {
  it("montre un visuel de remplacement dans la liste, pas une erreur", () => {
    renderIn(<CatalogueTable produits={[produit({ photos: [] })]} />);

    // La ligne reste complète et lisible.
    expect(screen.getByText("DOLIPRANE 500 mg")).toBeInTheDocument();
    expect(screen.getByText("18,00 DH")).toBeInTheDocument();
    // Aucune image cassée : le remplacement n'est pas un <img>.
    expect(document.querySelector("img")).toBeNull();
  });

  it("bascule sur le remplacement si l'image ne charge pas", () => {
    renderIn(<CatalogueTable produits={[produit({ photos: [photo("https://s/morte.jpg", 0)] })]} />);

    const image = document.querySelector("img")!;
    expect(image).toHaveAttribute("src", "https://s/morte.jpg");

    fireEvent.error(image);

    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("DOLIPRANE 500 mg")).toBeInTheDocument();
  });

  it("tolère une fiche dont la relation photos n'a pas été chargée", () => {
    // Un payload RSC mis en cache avant l'ajout des photos, ou une requête
    // sans `include` : la liste doit afficher la tuile neutre, pas planter.
    expect(principalPhoto(undefined)).toBeNull();
    expect(principalPhoto(null)).toBeNull();

    const sansRelation = { ...produit(), photos: undefined } as unknown as CatalogueProduitRecord;
    renderIn(<CatalogueTable produits={[sansRelation]} />);
    expect(screen.getByText("DOLIPRANE 500 mg")).toBeInTheDocument();
  });

  it("affiche la zone de dépôt même sans aucune photo", () => {
    renderIn(<CataloguePhotoField value={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/Glissez vos photos ici/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`0/${MAX_CATALOGUE_PHOTOS}`))).toBeInTheDocument();
  });
});

describe("photo principale", () => {
  it("prend l'ordre le plus bas", () => {
    const photos = [photo("c", 2), photo("a", 0), photo("b", 1)];
    expect(principalPhoto(photos)!.url).toBe("a");
  });

  it("départage deux ordres égaux par la plus ancienne, pas au hasard", () => {
    const photos = [photo("recente", 0, "2026-05-01"), photo("ancienne", 0, "2026-01-01")];
    expect(principalPhoto(photos)!.url).toBe("ancienne");
  });

  it("renvoie null plutôt que de lever quand il n'y en a aucune", () => {
    expect(principalPhoto([])).toBeNull();
  });

  it("ne modifie pas le tableau qu'on lui passe", () => {
    const photos = [photo("c", 2), photo("a", 0)];
    principalPhoto(photos);
    expect(photos[0]!.url).toBe("c");
  });

  it("affiche la principale, pas la première venue", () => {
    renderIn(
      <CatalogueTable
        produits={[
          produit({ photos: [photo("https://s/seconde.jpg", 1), photo("https://s/principale.jpg", 0)] }),
        ]}
      />,
    );
    expect(document.querySelector("img")).toHaveAttribute("src", "https://s/principale.jpg");
  });
});

describe("réordonnancement", () => {
  it("déplace une photo et fait de la nouvelle première la principale", () => {
    const onChange = vi.fn();
    renderIn(<CataloguePhotoField value={["a", "b", "c"]} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText("Déplacer la photo 2 vers la gauche"));
    expect(onChange).toHaveBeenCalledWith(["b", "a", "c"]);
  });

  it("marque la première comme principale", () => {
    renderIn(<CataloguePhotoField value={["a", "b"]} onChange={vi.fn()} />);
    expect(screen.getByText("Principale")).toBeInTheDocument();
    expect(screen.getAllByText("Principale")).toHaveLength(1);
  });

  it("ne propose pas de sortir des bornes", () => {
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 1, 2)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 0, 0)).toEqual(["a", "b"]);
  });
});

describe("limites de fichiers", () => {
  const file = (name: string, type: string, size: number) => ({ name, type, size });

  it("accepte jpg, png et webp", () => {
    expect(rejectionReason(file("a.jpg", "image/jpeg", 1000))).toBeNull();
    expect(rejectionReason(file("a.png", "image/png", 1000))).toBeNull();
    expect(rejectionReason(file("a.webp", "image/webp", 1000))).toBeNull();
  });

  it("refuse les autres formats, SVG et PDF compris", () => {
    expect(rejectionReason(file("a.svg", "image/svg+xml", 1000))).toMatch(/format non accepté/);
    expect(rejectionReason(file("a.pdf", "application/pdf", 1000))).toMatch(/format non accepté/);
    expect(rejectionReason(file("a.heic", "image/heic", 1000))).toMatch(/format non accepté/);
  });

  it("refuse au-delà de 5 Mo, en disant le poids réel", () => {
    const reason = rejectionReason(file("grosse.jpg", "image/jpeg", 12 * 1024 * 1024));
    expect(reason).toMatch(/12 Mo/);
    expect(reason).toMatch(/5 Mo/);
    expect(rejectionReason(file("limite.jpg", "image/jpeg", MAX_CATALOGUE_PHOTO_SIZE_BYTES))).toBeNull();
  });

  it("refuse un fichier vide", () => {
    expect(rejectionReason(file("vide.jpg", "image/jpeg", 0))).toMatch(/vide/);
  });

  it("plafonne à six photos", () => {
    const sept = Array.from({ length: 7 }, (_, index) => `https://s/${index}.jpg`);
    expect(renumber(sept)).toHaveLength(MAX_CATALOGUE_PHOTOS);
  });

  it("ferme la zone de dépôt une fois le maximum atteint", () => {
    const six = Array.from({ length: MAX_CATALOGUE_PHOTOS }, (_, index) => `https://s/${index}.jpg`);
    renderIn(<CataloguePhotoField value={six} onChange={vi.fn()} />);

    expect(screen.getByText(/Maximum atteint/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Choisir des fichiers/ })).not.toBeInTheDocument();
  });
});
