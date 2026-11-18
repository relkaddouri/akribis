import { describe, expect, it } from "vitest";
import {
  ecartCaisse,
  especesEncaissees,
  especesTheoriques,
  formatNumeroZ,
  scopeCompteurZ,
  sessionEnRetard,
  totauxZ,
  ventilationParPaiement,
  ventilationTva,
  type VenteDuZ,
} from "@/lib/caisse/journal-z";

/**
 * Le calcul du Journal Z.
 *
 * Ce sont les chiffres que le pharmacien recopie dans sa comptabilité et
 * qu'un contrôle relit : ils se vérifient ici, sans base ni écran.
 */

function vente(surcharges: Partial<VenteDuZ> = {}): VenteDuZ {
  return {
    paymentMethod: "CASH",
    totalAmount: 100,
    montantPartClient: 100,
    montantPartAssurance: 0,
    montantRetourne: 0,
    lignes: [{ totalHt: 83.33, totalTva: 16.67, tauxTva: 20 }],
    ...surcharges,
  };
}

describe("espèces encaissées", () => {
  it("ne compte que les ventes réglées en espèces", () => {
    expect(
      especesEncaissees([
        vente({ montantPartClient: 100 }),
        vente({ paymentMethod: "CARD", montantPartClient: 250 }),
        vente({ paymentMethod: "CREDIT", montantPartClient: 80 }),
      ]),
    ).toBe(100);
  });

  it("prend la part client, pas le total du ticket", () => {
    /*
     * Le piège du module. Sur une vente en espèces avec tiers payant, le
     * client ne pose sur le comptoir que sa part ; le reste sera réclamé
     * à l'organisme. Compter le total ferait apparaître un manque à
     * chaque clôture, du montant exact de ce que l'officine n'a jamais
     * reçu — et ferait chercher un vol là où il n'y en a pas.
     */
    expect(
      especesEncaissees([
        vente({ totalAmount: 100, montantPartClient: 30, montantPartAssurance: 70 }),
      ]),
    ).toBe(30);
  });

  it("retranche ce qui est ressorti du tiroir en remboursement", () => {
    expect(especesEncaissees([vente({ montantPartClient: 100, montantRetourne: 40 })])).toBe(60);
  });

  it("ne se laisse pas piéger par les centimes", () => {
    expect(
      especesEncaissees([
        vente({ montantPartClient: 0.1 }),
        vente({ montantPartClient: 0.2 }),
      ]),
    ).toBe(0.3);
  });
});

describe("écart de caisse", () => {
  it("ajoute le fond initial au théorique", () => {
    expect(especesTheoriques(200, [vente({ montantPartClient: 350 })])).toBe(550);
  });

  it("est nul quand le compte y est", () => {
    const theoriques = especesTheoriques(200, [vente({ montantPartClient: 350 })]);
    expect(ecartCaisse(550, theoriques)).toBe(0);
  });

  it("est NÉGATIF quand il manque de l'argent", () => {
    // La convention comptable, et celle qu'attend qui lit un Z. La prendre
    // à l'envers ferait lire un vol comme un excédent.
    const theoriques = especesTheoriques(200, [vente({ montantPartClient: 350 })]);
    expect(ecartCaisse(530, theoriques)).toBe(-20);
  });

  it("est positif quand le tiroir contient plus que prévu", () => {
    const theoriques = especesTheoriques(200, [vente({ montantPartClient: 350 })]);
    expect(ecartCaisse(575, theoriques)).toBe(25);
  });

  it("reste exact au centime sur une journée de vraies ventes", () => {
    const journee = [
      vente({ montantPartClient: 52.4 }),
      vente({ montantPartClient: 14 }),
      vente({ montantPartClient: 18.35, montantRetourne: 18.35 }),
      vente({ paymentMethod: "CARD", montantPartClient: 220.9 }),
      vente({ totalAmount: 300, montantPartClient: 90, montantPartAssurance: 210 }),
    ];
    // 300 + 52,40 + 14 + (18,35 − 18,35) + 90 = 456,40. La carte n'entre pas.
    expect(especesTheoriques(300, journee)).toBe(456.4);
    expect(ecartCaisse(456.4, 456.4)).toBe(0);
  });
});

describe("ventilation par mode de paiement", () => {
  it("sépare les modes que la caisse sait produire", () => {
    // Trois, et pas quatre : le chèque n'existe pas dans l'énumération
    // `PaymentMethod`, et le comptoir ne le propose pas. Une ligne
    // « Chèque : 0,00 » sur chaque Z ferait chercher où ils sont passés.
    const total = ventilationParPaiement([
      vente({ paymentMethod: "CASH", montantPartClient: 100 }),
      vente({ paymentMethod: "CARD", montantPartClient: 200 }),
      vente({ paymentMethod: "CREDIT", montantPartClient: 30 }),
    ]);
    expect(total).toEqual({ CASH: 100, CARD: 200, CREDIT: 30, tiersPayant: 0 });
  });

  it("compte le tiers payant à part, jamais comme un mode de paiement", () => {
    // C'est une créance, pas un encaissement : l'additionner aux autres
    // ferait un total que la caisse ne contient pas.
    const total = ventilationParPaiement([
      vente({ paymentMethod: "CASH", montantPartClient: 30, montantPartAssurance: 70 }),
    ]);
    expect(total.CASH).toBe(30);
    expect(total.tiersPayant).toBe(70);
    expect(total.CASH + total.CARD + total.CREDIT).toBe(30);
  });
});

describe("ventilation TVA", () => {
  it("regroupe par taux et trie du plus bas au plus haut", () => {
    const lignes = ventilationTva([
      vente({ lignes: [{ totalHt: 100, totalTva: 20, tauxTva: 20 }] }),
      vente({ lignes: [{ totalHt: 50, totalTva: 3.5, tauxTva: 7 }] }),
      vente({ lignes: [{ totalHt: 30, totalTva: 0, tauxTva: 0 }] }),
      vente({ lignes: [{ totalHt: 200, totalTva: 40, tauxTva: 20 }] }),
    ]);

    expect(lignes).toEqual([
      { taux: 0, baseHt: 30, tva: 0 },
      { taux: 7, baseHt: 50, tva: 3.5 },
      { taux: 20, baseHt: 300, tva: 60 },
    ]);
  });

  it("n'invente pas les taux absents", () => {
    // « TVA 20 % : 0,00 » sur une officine qui ne vend qu'à 7 % ajoute une
    // ligne à lire pour ne rien apprendre.
    const lignes = ventilationTva([vente({ lignes: [{ totalHt: 50, totalTva: 3.5, tauxTva: 7 }] })]);
    expect(lignes.map((l) => l.taux)).toEqual([7]);
  });
});

describe("totaux", () => {
  it("déduit le net du brut et des retours", () => {
    expect(
      totauxZ([vente({ totalAmount: 100 }), vente({ totalAmount: 60, montantRetourne: 25 })]),
    ).toEqual({ caBrut: 160, retours: 25, caNet: 135, nombreVentes: 2 });
  });
});

describe("numéro de Z", () => {
  it("suit le format Z-AAAA-MM-JJ-NNN", () => {
    expect(formatNumeroZ(new Date(2026, 7, 22, 20, 30), 1)).toBe("Z-2026-08-22-001");
    expect(formatNumeroZ(new Date(2026, 0, 5, 20, 30), 42)).toBe("Z-2026-01-05-042");
  });

  it("prend la date locale, pas UTC", () => {
    // Une caisse fermée le 22 à 00 h 30 serait datée du 21 en UTC — le Z
    // porterait alors la date de la veille sur la journée qu'il arrête.
    expect(formatNumeroZ(new Date(2026, 7, 22, 0, 30), 1)).toBe("Z-2026-08-22-001");
  });

  it("donne une portée de compteur par jour, pour que NNN reparte à 1", () => {
    expect(scopeCompteurZ(new Date(2026, 7, 22))).toBe("caisse_z:2026-08-22");
    expect(scopeCompteurZ(new Date(2026, 7, 23))).not.toBe(scopeCompteurZ(new Date(2026, 7, 22)));
  });
});

describe("session en retard", () => {
  it("ne l'est pas dans la journée", () => {
    expect(sessionEnRetard(new Date(2026, 7, 22, 8, 0), new Date(2026, 7, 22, 23, 59))).toBe(false);
  });

  it("l'est dès le lendemain, même à moins de vingt-quatre heures", () => {
    // Une caisse ouverte hier à 9 h et regardée aujourd'hui à 8 h n'a que
    // 23 heures, et doit pourtant être clôturée : chaque journée a son Z.
    expect(sessionEnRetard(new Date(2026, 7, 21, 9, 0), new Date(2026, 7, 22, 8, 0))).toBe(true);
  });

  it("l'est au passage d'une année", () => {
    expect(sessionEnRetard(new Date(2026, 11, 31, 20, 0), new Date(2027, 0, 1, 9, 0))).toBe(true);
  });
});
