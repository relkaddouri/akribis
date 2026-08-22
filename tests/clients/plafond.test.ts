import { describe, expect, it } from "vitest";
import { depassementPlafondCredit, margeDisponible } from "@/lib/clients/plafond";

/**
 * Le plafond de crédit, côté calcul.
 *
 * Convention de signe reprise de lib/clients/account.ts : un solde
 * NÉGATIF veut dire que le client doit à la pharmacie. C'est la source
 * d'erreur la plus probable ici, d'où des cas explicites dans les deux
 * sens.
 */

describe("dépassement de plafond", () => {
  it("ne dit rien sans plafond fixé", () => {
    expect(
      depassementPlafondCredit({ solde: -5000, plafondCredit: null, montantACrediter: 900 }),
    ).toBeNull();
  });

  it("ne dit rien tant que le plafond tient", () => {
    expect(
      depassementPlafondCredit({ solde: -200, plafondCredit: 1000, montantACrediter: 300 }),
    ).toBeNull();
  });

  it("ne dit rien quand la vente amène pile au plafond", () => {
    // La borne est incluse : un plafond de 1000 autorise de devoir 1000.
    expect(
      depassementPlafondCredit({ solde: -700, plafondCredit: 1000, montantACrediter: 300 }),
    ).toBeNull();
  });

  it("signale le dépassement, et de combien", () => {
    const r = depassementPlafondCredit({
      solde: -700,
      plafondCredit: 1000,
      montantACrediter: 450,
    });
    expect(r).toEqual({
      plafond: 1000,
      encoursActuel: 700,
      encoursApres: 1150,
      depassement: 150,
    });
  });

  it("traite un plafond à zéro comme une limite, pas comme une absence", () => {
    // Le titulaire qui saisit zéro refuse tout crédit à ce client. Le
    // taire perdrait la seule consigne qu'il ait laissée.
    const r = depassementPlafondCredit({ solde: 0, plafondCredit: 0, montantACrediter: 50 });
    expect(r?.depassement).toBe(50);
  });

  it("part du crédit du client quand la pharmacie lui doit de l'argent", () => {
    // Solde positif = la pharmacie doit au client. Une vente de 300 sur un
    // avoir de 100 ne laisse que 200 dus, pas 300.
    const r = depassementPlafondCredit({ solde: 100, plafondCredit: 150, montantACrediter: 300 });
    expect(r?.encoursApres).toBe(200);
    expect(r?.depassement).toBe(50);
  });

  it("ne se laisse pas piéger par les centimes", () => {
    const r = depassementPlafondCredit({
      solde: -0.1,
      plafondCredit: 0.2,
      montantACrediter: 0.2,
    });
    // 0.1 + 0.2 vaut 0.30000000000000004 en flottant : sans arrondi, le
    // dépassement s'afficherait avec dix-sept décimales.
    expect(r?.encoursApres).toBe(0.3);
    expect(r?.depassement).toBe(0.1);
  });
});

describe("marge encore disponible", () => {
  it("est nulle sans plafond", () => {
    expect(margeDisponible(-500, null)).toBeNull();
  });

  it("retranche ce que le client doit déjà", () => {
    expect(margeDisponible(-300, 1000)).toBe(700);
  });

  it("ne descend jamais sous zéro", () => {
    // Un dépassement déjà constaté laisse une marge de zéro, pas une
    // marge négative — « −200 disponibles » ne veut rien dire à l'écran.
    expect(margeDisponible(-1200, 1000)).toBe(0);
  });
});
