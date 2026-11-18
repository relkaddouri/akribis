import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CategorieBadge } from "@/components/features/catalogue/categorie-badge";

/**
 * La catégorie détermine le taux de TVA : la distinction doit se voir sans
 * être lue. Ce test verrouille qu'une famille n'emprunte pas la couleur
 * d'une autre — une régression invisible autrement.
 */
const teinte = (element: HTMLElement) =>
  (element.className.match(/bg-(\w+)-\d+/) ?? [])[1];

function rendre(categorie: string | null) {
  const { container } = render(<CategorieBadge categorie={categorie} />);
  return container.firstElementChild as HTMLElement;
}

describe("pastille de catégorie", () => {
  it("nomme chaque famille", () => {
    expect(rendre("PHARMACEUTIQUE")).toHaveTextContent("Pharmaceutique");
    expect(rendre("PARAPHARMACEUTIQUE")).toHaveTextContent("Parapharmaceutique");
    expect(rendre("DISPOSITIF_MEDICAL")).toHaveTextContent("Dispositif médical");
  });

  it("donne une couleur différente à chacune", () => {
    const couleurs = [
      teinte(rendre("PHARMACEUTIQUE")),
      teinte(rendre("PARAPHARMACEUTIQUE")),
      teinte(rendre("DISPOSITIF_MEDICAL")),
    ];
    expect(couleurs.every(Boolean)).toBe(true);
    expect(new Set(couleurs).size).toBe(3);
  });

  it("évite l'émeraude de la marque et l'ambre des alertes", () => {
    for (const c of ["PHARMACEUTIQUE", "PARAPHARMACEUTIQUE", "DISPOSITIF_MEDICAL"]) {
      expect(["emerald", "amber"]).not.toContain(teinte(rendre(c)));
    }
  });

  it("porte sa déclinaison sombre", () => {
    for (const c of ["PHARMACEUTIQUE", "PARAPHARMACEUTIQUE", "DISPOSITIF_MEDICAL", null]) {
      expect(rendre(c).className).toMatch(/dark:bg-\w+-\d+/);
      expect(rendre(c).className).toMatch(/dark:text-\w+-\d+/);
    }
  });

  it("signale une fiche sans catégorie en ambre, comme les autres alertes", () => {
    const badge = rendre(null);
    expect(badge).toHaveTextContent("À classer");
    expect(teinte(badge)).toBe("amber");
  });

  it("retombe sur « À classer » plutôt que de casser sur une valeur inconnue", () => {
    expect(rendre("COSMETIQUE_VETERINAIRE")).toHaveTextContent("À classer");
  });

  it("garde le libellé accessible en mode icône seule", () => {
    render(<CategorieBadge categorie="PHARMACEUTIQUE" iconOnly />);
    expect(screen.getByText("Pharmaceutique")).toHaveClass("sr-only");
  });
});
