import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderAvecProviders } from "@/tests/fixtures/render-avec-providers";
import { ProductActifSwitch } from "@/components/features/stock/product-actif-switch";

/**
 * L'interrupteur « en vente / retiré de la vente » ne doit jamais bouger
 * de lui-même : la boîte de dialogue décide, le serveur écrit, et c'est
 * l'enregistrement rafraîchi qui déplace le bouton. Un interrupteur qui
 * bascule à l'écran sans que rien ne soit écrit annonce un état que la
 * base ne porte pas.
 */

const bascule = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
vi.mock("@/lib/server/stock-entry", () => ({ setProductActifLocalement: bascule }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/offline/products", () => ({ markProductActifLocalement: vi.fn(async () => {}) }));

beforeEach(() => bascule.mockClear());

const rendre = (value: boolean) =>
  renderAvecProviders(
    <ProductActifSwitch productId="p1" productName="ACEPRIL" value={value} showState />,
  );

/**
 * `hidden: true` : la boîte de dialogue ouverte pose `aria-hidden` sur le
 * reste de la page, ce qui retire l'interrupteur de l'arbre
 * d'accessibilité. C'est le comportement attendu — mais on veut quand
 * même pouvoir constater qu'il n'a pas bougé pendant ce temps.
 */
const interrupteur = () => screen.getByRole("switch", { hidden: true });

describe("l'état affiché suit la donnée", () => {
  it("montre « En vente » pour un produit actif", () => {
    rendre(true);
    expect(interrupteur().getAttribute("data-state")).toBe("checked");
    expect(screen.getByText("En vente")).toBeTruthy();
  });

  it("montre « Retiré de la vente » pour un produit désactivé", () => {
    rendre(false);
    expect(interrupteur().getAttribute("data-state")).toBe("unchecked");
    expect(screen.getByText("Retiré de la vente")).toBeTruthy();
  });
});

/**
 * Le défaut constaté en production : la fiche affichait « Retiré de la
 * vente » sur un produit que la base donnait actif, et l'interrupteur
 * basculait de lui-même au clic pendant que la boîte de dialogue posait
 * la question inverse.
 *
 * Cause : `checked={undefined}` fait passer Radix en mode non contrôlé.
 * La donnée arrivait sans le champ — un client Prisma généré avant la
 * migration `actif_localement` suffit à produire ça, et une ligne mise en
 * cache avant elle aussi.
 */
describe("quand la donnée arrive sans le champ", () => {
  const sansChamp = () =>
    renderAvecProviders(
      <ProductActifSwitch
        productId="p1"
        productName="ACEPRIL"
        value={undefined as unknown as boolean}
        showState
      />,
    );

  it("considère le produit en vente plutôt que retiré", () => {
    // Même règle que la couche hors-ligne et que la valeur par défaut de
    // la colonne : un produit est en vente tant que personne ne l'a retiré.
    sansChamp();
    expect(interrupteur().getAttribute("data-state")).toBe("checked");
    expect(screen.getByText("En vente")).toBeTruthy();
  });

  it("ne bascule toujours pas tout seul", () => {
    sansChamp();
    fireEvent.click(interrupteur());
    expect(interrupteur().getAttribute("data-state")).toBe("checked");
    expect(screen.getByText("Retirer ce produit de la vente ?")).toBeTruthy();
  });
});

describe("quand l'écriture échoue", () => {
  function setOnline(value: boolean) {
    Object.defineProperty(navigator, "onLine", { value, configurable: true });
  }

  async function echouer() {
    bascule.mockRejectedValueOnce(new Error("Unknown argument `actifLocalement`"));
    rendre(true);
    fireEvent.click(interrupteur());
    fireEvent.click(screen.getByRole("button", { name: "Retirer de la vente" }));
    return screen.findByRole("alert");
  }

  it("parle de connexion seulement quand le navigateur est hors ligne", async () => {
    setOnline(false);
    expect((await echouer()).textContent).toMatch(/hors connexion/i);
  });

  it("ne diagnostique pas la connexion quand elle est là", async () => {
    // C'est le cas d'un serveur qui refuse l'écriture — annoncer « hors
    // connexion » enverrait chercher le problème au mauvais endroit.
    setOnline(true);
    const message = (await echouer()).textContent ?? "";
    expect(message).not.toMatch(/hors connexion/i);
    expect(message).toMatch(/n'a pas pu être enregistrée/i);
  });

  it("laisse l'interrupteur là où il était", async () => {
    setOnline(true);
    await echouer();
    expect(interrupteur().getAttribute("data-state")).toBe("checked");
  });
});

describe("l'interrupteur ne bouge pas tout seul", () => {
  it("reste en place tant que la confirmation n'est pas donnée", () => {
    rendre(true);
    fireEvent.click(interrupteur());

    // La question est posée…
    expect(screen.getByText("Retirer ce produit de la vente ?")).toBeTruthy();
    // …mais l'interrupteur n'a pas bougé, et rien n'a été écrit.
    expect(interrupteur().getAttribute("data-state")).toBe("checked");
    expect(bascule).not.toHaveBeenCalled();
  });

  it("revient intact après une annulation", () => {
    rendre(true);
    fireEvent.click(interrupteur());
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));

    expect(interrupteur().getAttribute("data-state")).toBe("checked");
    expect(bascule).not.toHaveBeenCalled();
  });

  it("ne bouge pas non plus après confirmation — c'est la donnée qui décide", async () => {
    rendre(true);
    fireEvent.click(interrupteur());
    fireEvent.click(screen.getByRole("button", { name: "Retirer de la vente" }));

    await waitFor(() => expect(bascule).toHaveBeenCalledWith("p1", false));
    // La prop `value` n'a pas changé : le bouton doit refléter la donnée,
    // pas anticiper le résultat.
    expect(interrupteur().getAttribute("data-state")).toBe("checked");
  });

  it("pose la bonne question dans l'autre sens", () => {
    rendre(false);
    fireEvent.click(interrupteur());
    expect(screen.getByText("Remettre ce produit en vente ?")).toBeTruthy();
    expect(interrupteur().getAttribute("data-state")).toBe("unchecked");
  });
});
