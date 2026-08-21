import { describe, expect, it } from "vitest";
import {
  calculerPartage,
  contientRemboursable,
  baseAppliquee,
  partAssuranceLigne,
  type LigneRemboursable,
} from "@/lib/pos/tiers-payant";
import { addToCart, round2 } from "@/lib/pos/cart";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Le partage entre le client et l'organisme.
 *
 * L'invariant qui compte : `partClient + partAssurance == total`, au
 * centime près et sans exception. S'il se rompt, la caisse ne tombe pas
 * juste — le client paie un centime de trop ou de moins, chaque jour, sur
 * des dizaines de ventes, et personne ne sait d'où vient l'écart.
 */

function ligne(overrides: Partial<LigneRemboursable> = {}): LigneRemboursable {
  return { unitPrice: 18.5, quantity: 1, remboursable: true, baseRemboursement: 15, ...overrides };
}

describe("l'invariant de la somme", () => {
  it("tient sur un cas simple", () => {
    const p = calculerPartage([ligne()], 70);
    expect(round2(p.partClient + p.partAssurance)).toBe(p.total);
  });

  it("tient sans organisme", () => {
    const p = calculerPartage([ligne()], null);
    expect(p.partAssurance).toBe(0);
    expect(p.partClient).toBe(p.total);
  });

  /**
   * Le vrai test : des centaines de paniers tirés au hasard, avec des prix
   * et des taux choisis pour tomber au milieu d'un centime. C'est là que
   * deux arrondis indépendants divergent, pas sur 18,50 à 70 %.
   */
  it("tient sur 2 000 paniers tirés au hasard", () => {
    let graine = 42;
    const suivant = () => {
      graine = (graine * 1103515245 + 12345) % 2147483648;
      return graine / 2147483648;
    };
    const entre = (min: number, max: number) => min + suivant() * (max - min);

    const ecarts: string[] = [];

    for (let essai = 0; essai < 2000; essai += 1) {
      const lignes: LigneRemboursable[] = Array.from(
        { length: 1 + Math.floor(suivant() * 6) },
        () => {
          const prix = round2(entre(0.01, 999.99));
          return {
            unitPrice: prix,
            quantity: 1 + Math.floor(suivant() * 9),
            remboursable: suivant() > 0.3,
            // Parfois au-dessus du prix payé : c'est le cas du générique,
            // et celui qui fait mordre le plafond.
            baseRemboursement: suivant() > 0.15 ? round2(entre(0.01, prix * 1.4)) : null,
          };
        },
      );
      // Des taux non ronds : 33,33 % produit des demi-centimes là où 70 %
      // n'en produit jamais.
      const taux = round2(entre(0.01, 100));

      const p = calculerPartage(lignes, taux);
      if (round2(p.partClient + p.partAssurance) !== p.total) {
        ecarts.push(
          `taux ${taux} : ${p.partClient} + ${p.partAssurance} = ` +
            `${round2(p.partClient + p.partAssurance)} au lieu de ${p.total}`,
        );
      }
    }

    expect(ecarts.slice(0, 5), `${ecarts.length} panier(s) en écart`).toEqual([]);
  });

  it("tient quand la part assurance dépasserait le total", () => {
    // Taux à 100 % sur une base supérieure au prix : sans plafond, la part
    // client deviendrait négative — une caisse qui rend de l'argent.
    const p = calculerPartage([ligne({ unitPrice: 10, baseRemboursement: 40 })], 100);
    expect(p.partAssurance).toBe(10);
    expect(p.partClient).toBe(0);
    expect(round2(p.partClient + p.partAssurance)).toBe(p.total);
  });
});

/**
 * Chaque ligne archive ce qu'elle réclame, et la vente archive le total.
 * Si les deux ne coïncident pas, un bordereau rapproché ligne à ligne ne
 * tombera jamais juste — et personne ne saura laquelle des deux valeurs
 * croire.
 */
describe("la somme des lignes égale la part de la vente", () => {
  it("tient sur un panier mixte", () => {
    const lignes = [
      ligne({ unitPrice: 98, baseRemboursement: 98 }),
      ligne({ unitPrice: 78.21, remboursable: false, baseRemboursement: null }),
      ligne({ unitPrice: 11.75, baseRemboursement: 10.2 }),
      ligne({ unitPrice: 18, baseRemboursement: 70 }),
      ligne({ unitPrice: 52.4, baseRemboursement: 52.4 }),
    ];
    const p = calculerPartage(lignes, 70);
    const sommeLignes = round2(
      lignes.reduce((total, l) => total + partAssuranceLigne(l, 70), 0),
    );
    expect(sommeLignes).toBe(p.partAssurance);
    expect(p.partAssurance).toBe(125.02);
  });

  it("tient sur 2 000 paniers tirés au hasard", () => {
    // C'est ici que l'arrondi par ligne se distingue d'un arrondi sur la
    // somme : additionner cinq lignes coupées au demi-centime dérive.
    let graine = 7;
    const suivant = () => {
      graine = (graine * 1103515245 + 12345) % 2147483648;
      return graine / 2147483648;
    };
    const entre = (min: number, max: number) => min + suivant() * (max - min);

    const ecarts: string[] = [];
    for (let essai = 0; essai < 2000; essai += 1) {
      const lignes: LigneRemboursable[] = Array.from(
        { length: 1 + Math.floor(suivant() * 6) },
        () => {
          const prix = round2(entre(0.01, 999.99));
          return {
            unitPrice: prix,
            quantity: 1 + Math.floor(suivant() * 9),
            remboursable: suivant() > 0.3,
            baseRemboursement: suivant() > 0.15 ? round2(entre(0.01, prix * 1.4)) : null,
          };
        },
      );
      const taux = round2(entre(0.01, 100));
      const p = calculerPartage(lignes, taux);
      const somme = round2(
        lignes.reduce((total, l) => total + partAssuranceLigne(l, taux), 0),
      );
      if (somme !== p.partAssurance) {
        ecarts.push(`taux ${taux} : lignes ${somme} ≠ vente ${p.partAssurance}`);
      }
    }
    expect(ecarts.slice(0, 5), `${ecarts.length} panier(s) en écart`).toEqual([]);
  });

  it("une ligne non remboursable ne réclame rien", () => {
    expect(partAssuranceLigne(ligne({ remboursable: false }), 70)).toBe(0);
    expect(partAssuranceLigne(ligne({ baseRemboursement: null }), 70)).toBe(0);
    expect(partAssuranceLigne(ligne(), null)).toBe(0);
  });
});

describe("ce que l'organisme prend en charge", () => {
  it("applique le taux à la base, pas au prix de vente", () => {
    // 15 DH de base à 70 % = 10,50 — et non 70 % de 18,50.
    const p = calculerPartage([ligne({ unitPrice: 18.5, baseRemboursement: 15 })], 70);
    expect(p.partAssurance).toBe(10.5);
    expect(p.partClient).toBe(8);
  });

  it("compte la quantité", () => {
    const p = calculerPartage([ligne({ quantity: 3 })], 70);
    expect(p.partAssurance).toBe(31.5);
  });

  it("ne rembourse jamais plus que le prix payé", () => {
    // Générique vendu 10 DH avec une base de référence à 15 : l'officine
    // ne peut pas réclamer plus qu'elle n'a encaissé.
    //
    // La seconde ligne, non remboursable, gonfle le total à 110 : sans
    // elle, le plafond global (partAssurance ≤ total) suffirait à ramener
    // le résultat à 10, et le test passerait même sans plafond par ligne.
    const p = calculerPartage(
      [
        ligne({ unitPrice: 10, baseRemboursement: 15 }),
        ligne({ unitPrice: 100, remboursable: false, baseRemboursement: null }),
      ],
      100,
    );
    expect(p.partAssurance).toBe(10);
    expect(p.partClient).toBe(100);
  });

  it("ignore une ligne non remboursable", () => {
    const p = calculerPartage(
      [ligne({ remboursable: false, unitPrice: 20, baseRemboursement: 20 })],
      70,
    );
    expect(p.partAssurance).toBe(0);
    expect(p.partClient).toBe(20);
  });

  it("ignore un produit remboursable sans base saisie", () => {
    // Réclamer au hasard vaut moins que ne rien réclamer.
    const p = calculerPartage([ligne({ baseRemboursement: null })], 70);
    expect(p.partAssurance).toBe(0);
  });

  it("ne partage rien à taux nul", () => {
    const p = calculerPartage([ligne()], 0);
    expect(p.partAssurance).toBe(0);
    expect(p.partClient).toBe(p.total);
  });

  it("mêle remboursable et non remboursable dans le même panier", () => {
    const p = calculerPartage(
      [
        ligne({ unitPrice: 18.5, baseRemboursement: 15 }),
        ligne({ unitPrice: 75, remboursable: false, baseRemboursement: null }),
      ],
      70,
    );
    expect(p.total).toBe(93.5);
    expect(p.partAssurance).toBe(10.5);
    expect(p.partClient).toBe(83);
  });
});

describe("quand proposer un organisme", () => {
  it("dès qu'une ligne remboursable porte une base", () => {
    expect(contientRemboursable([ligne()])).toBe(true);
  });

  it("jamais sur un panier sans remboursable", () => {
    expect(contientRemboursable([ligne({ remboursable: false })])).toBe(false);
    expect(contientRemboursable([])).toBe(false);
  });

  it("ni sur un remboursable dont la base manque", () => {
    // Le sélecteur promettrait un remboursement que le calcul ne donnera pas.
    expect(contientRemboursable([ligne({ baseRemboursement: null })])).toBe(false);
  });
});

/**
 * Le trajet du produit jusqu'à la ligne de panier.
 *
 * `remboursable` et `baseRemboursement` sont optionnels sur `CartProduct`,
 * parce qu'un produit mis en cache avant le tiers payant ne les porte pas.
 * Le revers : un appelant qui les oublie ne fait pas broncher `tsc`, et
 * toutes les lignes deviennent « non remboursables » — le sélecteur
 * disparaît, la fonctionnalité entière avec lui, sans une erreur.
 *
 * C'est arrivé : le POS construisait son `CartProduct` avec quatre champs.
 */
describe("le panier retient le droit à remboursement", () => {
  it("recopie les deux champs depuis le produit", () => {
    const { lines } = addToCart([], {
      id: "p1",
      name: "DOLIPRANE",
      price: 11.75,
      quantityInStock: 10,
      remboursable: true,
      baseRemboursement: 10.2,
    });
    expect(lines[0]!.remboursable).toBe(true);
    expect(lines[0]!.baseRemboursement).toBe(10.2);
    expect(contientRemboursable(lines)).toBe(true);
  });

  it("retombe sur « non remboursable » quand le produit ne les porte pas", () => {
    const { lines } = addToCart([], {
      id: "p1",
      name: "Ancien cache",
      price: 10,
      quantityInStock: 10,
    });
    expect(lines[0]!.remboursable).toBe(false);
    expect(contientRemboursable(lines)).toBe(false);
  });

  it("le POS transmet bien les deux champs", () => {
    // Test de source : l'appel vit dans un composant que ce fichier ne
    // peut pas monter, et c'est précisément l'oubli qui s'était produit.
    const src = readFileSync(
      resolve(__dirname, "../..", "components/features/pos/pos-view.tsx"),
      "utf8",
    );
    const appel = /addToCart\(prevLines, \{[\s\S]*?\}\);/.exec(src);
    expect(appel, "appel à addToCart introuvable").toBeTruthy();
    expect(appel![0]).toMatch(/remboursable: product\.remboursable/);
    expect(appel![0]).toMatch(/baseRemboursement: product\.baseRemboursement/);
  });
});

/**
 * L'ordre des deux sources n'est pas indifférent : lire le produit en
 * premier afficherait la base d'aujourd'hui sur une vente de l'an
 * dernier, donc un montant qui ne correspond ni à ce qui a été réclamé ni
 * à ce que l'organisme a payé.
 */
describe("quelle base afficher sur une ligne de vente", () => {
  it("préfère l'instantané, même quand le produit a changé depuis", () => {
    expect(baseAppliquee(10.2, 99)).toBe(10.2);
  });

  it("retombe sur le produit pour une vente d'avant l'instantané", () => {
    expect(baseAppliquee(null, 10.2)).toBe(10.2);
  });

  it("n'invente rien quand aucune des deux n'existe", () => {
    expect(baseAppliquee(null, null)).toBeNull();
  });

  it("garde un instantané à zéro plutôt que de le prendre pour absent", () => {
    // `??` et non `||` : une base réellement nulle est une information,
    // et `||` la remplacerait par celle du produit.
    expect(baseAppliquee(0, 99)).toBe(0);
  });
});
