import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Chaque segment doit monter les fournisseurs de contexte que ses pages
 * utilisent.
 *
 * Ce test existe parce que les tests de rendu ne peuvent pas l'attraper :
 * ils enveloppent le composant dans les fournisseurs eux-mêmes — c'est
 * même leur rôle. Un composant peut donc passer tous ses tests, `tsc`, le
 * lint et le build, et lever à la première requête réelle parce que le
 * layout ne monte rien. C'est arrivé deux fois : sur le layout Admin, puis
 * sur la fiche produit du dashboard, dont le seul Tooltip n'apparaît que
 * si le produit a une TVA à compléter — donc jamais dans les cas simples,
 * et jamais dans les tests de rendu.
 *
 * On lit le source des layouts plutôt que d'exécuter : un layout est un
 * composant serveur asynchrone qui appelle `requireUser()` et les cookies,
 * le monter en jsdom coûterait plus que ce que ce test rapporte.
 */

const racine = resolve(__dirname, "../..");

/** Les layouts de segment, qui enveloppent toutes les pages en dessous. */
const LAYOUTS = ["app/(dashboard)/layout.tsx", "app/(admin)/layout.tsx"];

/** Fournisseur -> ce qui lève sans lui. */
const REQUIS = [
  { fournisseur: "TooltipProvider", declencheur: "@/components/ui/tooltip" },
  { fournisseur: "QueryProvider", declencheur: "@tanstack/react-query" },
];

describe("les layouts montent ce que leurs pages utilisent", () => {
  for (const layout of LAYOUTS) {
    const source = readFileSync(resolve(racine, layout), "utf8");
    for (const { fournisseur } of REQUIS) {
      it(`${layout} monte ${fournisseur}`, () => {
        expect(
          new RegExp(`<${fournisseur}[\\s>]`).test(source),
          `${layout} ne monte pas ${fournisseur} : toute page du segment qui ` +
            `s'en sert lèvera à l'exécution, sans que rien d'autre ne le signale.`,
        ).toBe(true);
      });
    }
  }
});

/**
 * Garde-fou du test lui-même : il ne vaut que si des composants du
 * dashboard posent réellement des Tooltip. Le jour où plus personne n'en
 * pose, l'exigence ci-dessus devient du folklore — autant le savoir.
 */
describe("garde-fou", () => {
  function fichiers(dossier: string): string[] {
    const chemin = resolve(racine, dossier);
    return readdirSync(chemin).flatMap((nom) => {
      const complet = join(chemin, nom);
      if (statSync(complet).isDirectory()) return fichiers(join(dossier, nom));
      return complet.endsWith(".tsx") ? [complet] : [];
    });
  }

  it("des composants posent bien des Tooltip", () => {
    const poseurs = fichiers("components")
      .filter((f) => !f.endsWith("components/ui/tooltip.tsx"))
      .filter((f) => /<Tooltip[\s>]/.test(readFileSync(f, "utf8")));
    expect(poseurs.length).toBeGreaterThan(0);
  });
});
