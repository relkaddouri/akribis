import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DelaiPeremption, libelleDelai } from "@/components/features/stock/delai-peremption";

/**
 * Le délai avant péremption est écrit au même endroit pour la barre
 * d'alertes et pour la fiche produit : les deux écrans parlent du même
 * produit à quelques secondes d'intervalle, et deux formulations pour un
 * même fait se liraient comme deux faits.
 */

const AUJOURD_HUI = new Date("2026-08-20T10:00:00.000Z");

describe("le libellé", () => {
  it("compte les jours restants", () => {
    expect(libelleDelai(8)).toBe("dans 8 jours");
  });

  it("dit le jour même et le lendemain sans compter", () => {
    expect(libelleDelai(0)).toBe("périme aujourd'hui");
    expect(libelleDelai(1)).toBe("demain");
  });

  it("compte à rebours quand c'est déjà passé", () => {
    expect(libelleDelai(-19)).toBe("périmé depuis 19 j");
  });
});

describe("la couleur", () => {
  const rendre = (date: string) =>
    render(<DelaiPeremption date={date} from={AUJOURD_HUI} />).container.firstChild as HTMLElement;

  it("met en rouge ce qui périme dans le mois", () => {
    // C'est la demande : « dans 8 jours » doit se lire comme une urgence,
    // pas comme une note de bas de page.
    expect(rendre("2026-08-28").className).toContain("text-destructive");
  });

  it("met en rouge ce qui est déjà périmé", () => {
    expect(rendre("2026-08-01").className).toContain("text-destructive");
  });

  it("réserve l'ambre aux échéances lointaines", () => {
    // Aux horizons 60 et 90 jours, tout peindre en rouge lui ferait perdre
    // ce qu'il signale.
    const loin = rendre("2026-11-01");
    expect(loin.className).toContain("amber");
    expect(loin.className).not.toContain("text-destructive");
  });

  it("bascule pile à trente jours", () => {
    expect(rendre("2026-09-19").className).toContain("text-destructive");
    expect(rendre("2026-09-20").className).toContain("amber");
  });
});
