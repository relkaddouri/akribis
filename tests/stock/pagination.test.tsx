import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderAvecProviders } from "@/tests/fixtures/render-avec-providers";
import { ProductTable } from "@/components/features/stock/product-table";
import type { ProductRecord } from "@/lib/offline/products";

/**
 * La pagination du tableau de stock — dix lignes par page.
 *
 * Elle n'avait aucun test, et la page Stock est justement celle où le
 * nombre de lignes change sous les pieds de l'utilisateur : retenir une
 * pastille de la barre d'alertes remplace la liste des produits sans
 * passer par les filtres du tableau, donc sans repasser par la remise à
 * la page 1.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/server/stock-entry", () => ({
  setProductActifLocalement: vi.fn(async () => ({ ok: true as const })),
}));

function produits(n: number, prefixe = "P"): ProductRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefixe}${i}`,
    pharmacyId: "ph1",
    name: `${prefixe}RODUIT ${String(i).padStart(2, "0")}`,
    form: "Comprimé",
    dosage: null,
    laboratory: null,
    barcode: null,
    dci: null,
    photoUrl: null,
    category: null,
    categorie: "PHARMACEUTIQUE",
    sousCategorie: null,
    actifLocalement: true,
    price: 10,
    pph: null,
    tvaVente: 7,
    tvaAchat: 7,
    lowStockThreshold: 0,
    quantityInStock: 50,
    nearestExpiryDate: null,
    remboursable: false,
    baseRemboursement: null,
    posologieEnfant: null,
    posologieAdulte: null,
    monographie: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })) as ProductRecord[];
}

const rendre = (products: ProductRecord[]) =>
  renderAvecProviders(
    <ProductTable products={products} isLoading={false} search="" onSearchChange={() => {}} />,
  );

const lignes = () => within(screen.getByRole("table")).getAllByRole("row").length - 1;
const precedent = () => screen.getByRole("button", { name: "Page précédente" });
const suivant = () => screen.getByRole("button", { name: "Page suivante" });

describe("les bases", () => {
  it("coupe à dix lignes et annonce le total", () => {
    rendre(produits(35));
    expect(lignes()).toBe(10);
    expect(screen.getByText(/Page 1 sur 4 · 35 résultats/)).toBeTruthy();
  });

  it("ne montre aucun contrôle quand tout tient sur une page", () => {
    // Le cas de votre stock aujourd'hui : six produits, donc pas de
    // pagination visible — elle n'est pas absente, elle n'a rien à faire.
    rendre(produits(6));
    expect(lignes()).toBe(6);
    expect(screen.queryByText(/Page 1 sur/)).toBeNull();
  });

  it("avance et recule d'une page", () => {
    rendre(produits(35));
    fireEvent.click(suivant());
    expect(screen.getByText(/Page 2 sur 4/)).toBeTruthy();
    fireEvent.click(precedent());
    expect(screen.getByText(/Page 1 sur 4/)).toBeTruthy();
  });

  it("ne déborde ni d'un côté ni de l'autre", () => {
    rendre(produits(35));
    expect(precedent().hasAttribute("disabled")).toBe(true);
    fireEvent.click(suivant());
    fireEvent.click(suivant());
    fireEvent.click(suivant());
    expect(screen.getByText(/Page 4 sur 4/)).toBeTruthy();
    expect(suivant().hasAttribute("disabled")).toBe(true);
  });

  it("ne remplit la dernière page que de ce qui reste", () => {
    rendre(produits(35));
    fireEvent.click(suivant());
    fireEvent.click(suivant());
    fireEvent.click(suivant());
    expect(lignes()).toBe(5);
  });
});

describe("quand la liste rétrécit sous les pieds", () => {
  /** Ce que fait une pastille de la barre d'alertes : elle remplace les
   *  lignes du tableau sans passer par ses filtres, donc sans remise à la
   *  page 1. */
  const retrecir = (
    rerender: (ui: React.ReactElement) => void,
    n: number,
  ) =>
    rerender(
      <ProductTable products={produits(n)} isLoading={false} search="" onSearchChange={() => {}} />,
    );

  it("garde une page valide et des lignes cohérentes", () => {
    const { rerender } = rendre(produits(35));
    fireEvent.click(suivant());
    fireEvent.click(suivant());
    fireEvent.click(suivant());
    expect(screen.getByText(/Page 4 sur 4/)).toBeTruthy();

    retrecir(rerender, 15);
    expect(screen.getByText(/Page 2 sur 2 · 15 résultats/)).toBeTruthy();
    expect(lignes()).toBe(5);
  });

  it("recule d'une page au premier clic, pas au troisième", () => {
    // Le défaut : les boutons partaient de l'état interne (4) et non de la
    // page affichée (2). Reculer donnait 3, re-borné à 2 — rien ne bougeait,
    // et il fallait trois clics pour avancer d'un cran.
    const { rerender } = rendre(produits(35));
    fireEvent.click(suivant());
    fireEvent.click(suivant());
    fireEvent.click(suivant());
    retrecir(rerender, 15);
    expect(screen.getByText(/Page 2 sur 2/)).toBeTruthy();

    fireEvent.click(precedent());
    expect(screen.getByText(/Page 1 sur 2/)).toBeTruthy();
    expect(lignes()).toBe(10);
  });

  it("avance aussi d'un seul clic après un rétrécissement", () => {
    const { rerender } = rendre(produits(35));
    fireEvent.click(suivant());
    fireEvent.click(suivant());
    fireEvent.click(suivant());
    retrecir(rerender, 25);
    expect(screen.getByText(/Page 3 sur 3/)).toBeTruthy();
    fireEvent.click(precedent());
    expect(screen.getByText(/Page 2 sur 3/)).toBeTruthy();
    fireEvent.click(suivant());
    expect(screen.getByText(/Page 3 sur 3/)).toBeTruthy();
  });
});
