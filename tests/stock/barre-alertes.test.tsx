import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderAvecProviders } from "@/tests/fixtures/render-avec-providers";
import { StockAlertBar } from "@/components/features/stock/stock-alert-bar";
import { getExpiryAlerts } from "@/lib/stock/alerts";
import type { ProductForAlerts } from "@/lib/stock/alerts";

/**
 * La barre remplace deux encadrés qui, à eux deux, occupaient environ 250 px
 * pour redire le tableau situé juste en dessous — dont la moitié pour
 * afficher « Stock bas : 0 ».
 *
 * Ce que ce fichier verrouille, ce sont les trois raisons d'avoir changé :
 * le zéro ne coûte plus une carte, la liste porte de quoi décider
 * (quantité, valeur, forme), et l'ordre répond à « par quoi je commence »
 * plutôt qu'à « qu'est-ce qui périme en premier ».
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const AUJOURD_HUI = new Date("2026-08-20T10:00:00.000Z");

/**
 * Horloge figée.
 *
 * Les assertions sur « dans 8 jours » passaient par l'horloge réelle : le
 * composant ne reçoit pas de date injectable, contrairement aux fonctions
 * pures testées plus bas. Le fichier virait donc au rouge tout seul au
 * changement de date — ce qui est arrivé, un jour après son écriture.
 */
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AUJOURD_HUI);
});
afterAll(() => vi.useRealTimers());

function produit(overrides: Partial<ProductForAlerts> = {}): ProductForAlerts {
  return {
    id: "p1",
    name: "DOLIPRANE",
    form: "Comprimé sécable",
    dosage: "1 g",
    price: 14,
    quantityInStock: 120,
    lowStockThreshold: 10,
    nearestExpiryDate: null,
    ...overrides,
  };
}

const rendre = (
  products: ProductForAlerts[],
  scope: Parameters<typeof StockAlertBar>[0]["scope"] = null,
  onScopeChange: (scope: Parameters<typeof StockAlertBar>[0]["scope"]) => void = () => {},
) =>
  renderAvecProviders(
    <StockAlertBar products={products} scope={scope} onScopeChange={onScopeChange} />,
  );

describe("quand il n'y a rien à surveiller", () => {
  it("tient sur une ligne, sans pastille", () => {
    rendre([produit()]);
    expect(screen.getByText(/Rien à surveiller/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /périment/ })).toBeNull();
    // Le vieux « Aucune alerte de stock bas » occupait une carte entière.
    expect(screen.queryByText(/Aucune alerte/)).toBeNull();
  });
});

describe("les pastilles", () => {
  const perimeBientot = produit({
    id: "acepril",
    name: "ACEPRIL",
    form: "Comprimé",
    dosage: "4 mg",
    price: 98,
    nearestExpiryDate: "2026-08-28",
  });

  it("annonce le nombre et la valeur en jeu", () => {
    rendre([perimeBientot]);
    // 120 × 98 = 11 760. `\s` parce que le séparateur de milliers est une
    // espace fine insécable, que le nom accessible ne normalise pas.
    expect(
      screen.getByRole("button", { name: /1 périment sous 30 j · 11\s760 DH/ }),
    ).toBeTruthy();
  });

  it("garde le zéro du stock bas, en gris et sans action", () => {
    rendre([perimeBientot]);
    const zero = screen.getByRole("button", { name: /Stock bas : aucun/ });
    expect(zero.hasAttribute("disabled")).toBe(true);
    expect(zero.getAttribute("aria-pressed")).toBeNull();
  });

  it("réclame les prix restés à zéro", () => {
    rendre([produit({ id: "para", name: "Puressentiel", price: 0 })]);
    expect(screen.getByRole("button", { name: /1 prix à compléter/ })).toBeTruthy();
  });

  it("n'affiche pas de pastille prix quand tous les prix sont renseignés", () => {
    rendre([perimeBientot]);
    expect(screen.queryByRole("button", { name: /prix à compléter/ })).toBeNull();
  });

  it("montre laquelle est retenue", () => {
    rendre([perimeBientot], "peremption");
    expect(
      screen.getByRole("button", { name: /périment sous 30 j/ }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

describe("retenir une pastille", () => {
  const perimeBientot = produit({ id: "acepril", name: "ACEPRIL", price: 98, nearestExpiryDate: "2026-08-28" });

  it("la retient au clic", () => {
    const onScopeChange = vi.fn();
    rendre([perimeBientot], null, onScopeChange);
    fireEvent.click(screen.getByRole("button", { name: /périment sous 30 j/ }));
    expect(onScopeChange).toHaveBeenCalledWith("peremption");
  });

  it("la relâche au second clic", () => {
    // Sans quoi on entre dans une restriction du tableau dont on ne peut
    // plus sortir par le même geste.
    const onScopeChange = vi.fn();
    rendre([perimeBientot], "peremption", onScopeChange);
    fireEvent.click(screen.getByRole("button", { name: /périment sous 30 j/ }));
    expect(onScopeChange).toHaveBeenCalledWith(null);
  });

  it("ne rend pas le zéro du stock bas cliquable", () => {
    const onScopeChange = vi.fn();
    rendre([perimeBientot], null, onScopeChange);
    fireEvent.click(screen.getByRole("button", { name: /Stock bas : aucun/ }));
    expect(onScopeChange).not.toHaveBeenCalled();
  });
});

describe("la liste dépliée", () => {
  const produits = [
    produit({ id: "acepril", name: "ACEPRIL", form: "Comprimé", dosage: "4 mg", price: 98, nearestExpiryDate: "2026-08-28" }),
    produit({ id: "dol-cp", name: "DOLIPRANE", form: "Comprimé sécable", dosage: "1 g", price: 14, nearestExpiryDate: "2026-08-28" }),
    produit({ id: "dol-supp", name: "DOLIPRANE", form: "Suppositoire", dosage: "200 mg", price: 11.75, quantityInStock: 32, nearestExpiryDate: "2026-08-29" }),
  ];

  it("dit ce qui est en stock et ce que ça représente", () => {
    rendre(produits, "peremption");
    const ligne = screen.getByText("ACEPRIL").closest("a")!;
    expect(within(ligne).getByText(/120 u\. en stock · 11 760 DH/)).toBeTruthy();
    expect(within(ligne).getByText("dans 8 jours")).toBeTruthy();
  });

  it("distingue deux produits homonymes par leur forme", () => {
    rendre(produits, "peremption");
    // Les deux DOLIPRANE étaient deux chaînes identiques dans l'ancienne liste.
    expect(screen.getByText("Comprimé sécable · 1 g")).toBeTruthy();
    expect(screen.getByText("Suppositoire · 200 mg")).toBeTruthy();
  });

  it("reste repliée tant qu'aucune pastille n'est retenue", () => {
    rendre(produits);
    expect(screen.queryByText("Comprimé · 4 mg")).toBeNull();
  });
});

describe("l'ordre de la liste répond à « par quoi je commence »", () => {
  it("classe par valeur en jeu, pas par date", () => {
    const alertes = getExpiryAlerts(
      [
        produit({ id: "petit", price: 11.75, quantityInStock: 32, nearestExpiryDate: "2026-08-28" }),
        produit({ id: "gros", price: 98, quantityInStock: 120, nearestExpiryDate: "2026-08-29" }),
      ],
      30,
      AUJOURD_HUI,
    );
    // Le gros périme un jour plus tard, mais pèse 11 760 DH contre 376.
    expect(alertes.map((a) => a.productId)).toEqual(["gros", "petit"]);
  });

  it("fait quand même passer le déjà périmé en tête", () => {
    const gros = produit({ id: "gros", price: 98, quantityInStock: 120, nearestExpiryDate: "2026-08-29" });
    const moyen = produit({ id: "moyen", price: 52.4, quantityInStock: 40, nearestExpiryDate: "2026-08-28" });
    // Presque sans valeur, mais périmé : il doit sortir du rayon aujourd'hui.
    const perime = produit({ id: "perime", price: 2, quantityInStock: 1, nearestExpiryDate: "2026-08-01" });

    // Deux permutations : avec deux éléments seulement, l'ordre obtenu
    // dépendait de la façon dont V8 appelle le comparateur, et le test
    // passait même en retirant la priorité au périmé.
    for (const entree of [
      [gros, moyen, perime],
      [perime, gros, moyen],
    ]) {
      expect(getExpiryAlerts(entree, 30, AUJOURD_HUI).map((a) => a.productId)).toEqual([
        "perime",
        "gros",
        "moyen",
      ]);
    }
  });

  it("retombe sur la date quand la valeur est inconnue", () => {
    const alertes = getExpiryAlerts(
      [
        produit({ id: "tard", price: null, nearestExpiryDate: "2026-09-10" }),
        produit({ id: "tot", price: null, nearestExpiryDate: "2026-08-25" }),
      ],
      30,
      AUJOURD_HUI,
    );
    expect(alertes.map((a) => a.productId)).toEqual(["tot", "tard"]);
  });

  it("n'annonce aucune valeur quand le prix est inconnu ou nul", () => {
    const [sansPrix] = getExpiryAlerts(
      [produit({ price: 0, nearestExpiryDate: "2026-08-25" })],
      30,
      AUJOURD_HUI,
    );
    // Annoncer « 0 DH en jeu » sur 120 boîtes serait faux, pas prudent.
    expect(sansPrix!.valeurEnStock).toBeNull();
  });
});
