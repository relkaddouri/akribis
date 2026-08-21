import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Un `Decimal` Prisma qui traverse la frontière RSC fait échouer la page
 * qui le consomme, avec « Only plain objects can be passed to Client
 * Components ». Rien ne l'attrape avant : ni `tsc`, ni ESLint, ni le build
 * — seulement l'ouverture de la page.
 *
 * C'est arrivé deux fois : `products.purchasePrice`, puis
 * `catalogue_produits.prixVenteIndicatif`, chaque fois en ajoutant une
 * colonne au schéma sans penser à la façade. Ce test lit le schéma et la
 * façade, et échoue à la prochaine colonne oubliée — au moment où on
 * l'ajoute, pas des jours plus tard.
 */

const racine = resolve(__dirname, "../..");
const schema = readFileSync(resolve(racine, "prisma/schema.prisma"), "utf8");

/** Les colonnes `Decimal` déclarées sur un modèle du schéma. */
function colonnesDecimal(modele: string): string[] {
  const bloc = new RegExp(`^model ${modele} \\{(.*?)^\\}`, "ms").exec(schema);
  if (!bloc) throw new Error(`Modèle ${modele} introuvable dans le schéma`);
  return [...bloc[1]!.matchAll(/^\s+(\w+)\s+Decimal/gm)].map((m) => m[1]!);
}

/** Les champs listés dans le type `DecimalField` d'une façade. */
function champsConvertis(fichier: string): string[] {
  const src = readFileSync(resolve(racine, fichier), "utf8");
  const bloc = /type DecimalField =([\s\S]*?);/.exec(src);
  if (!bloc) throw new Error(`Pas de type DecimalField dans ${fichier}`);
  return [...bloc[1]!.matchAll(/"(\w+)"/g)].map((m) => m[1]!);
}

/** Les champs réellement convertis dans le corps de la façade. */
function conversionsEffectives(fichier: string, champs: string[]): string[] {
  const src = readFileSync(resolve(racine, fichier), "utf8");
  // La conversion prend deux formes dans le projet — `decimal(x)` d'un côté,
  // `x !== null ? Number(x) : null` de l'autre. On cherche donc `Number(` ou
  // `decimal(` n'importe où sur la ligne d'affectation, pas juste après les
  // deux-points : une première version trop stricte prenait la seconde forme
  // pour une absence de conversion.
  return champs.filter((champ) =>
    new RegExp(`\\b${champ}:[^\\n]*(?:decimal\\(|Number\\()`).test(src),
  );
}

const FACADES = [
  // La conversion vit dans un module ordinaire depuis que l'ajout au stock
  // en a besoin lui aussi — un fichier "use server" ne peut pas l'exporter.
  { fichier: "lib/catalogue/record.ts", modele: "CatalogueProduit" },
  { fichier: "lib/server/products.ts", modele: "Product" },
  // Ajoutee apres avoir constate qu'un Decimal renvoye par une Server
  // Action n'echoue pas : il arrive en CHAINE dans le navigateur, ce qui
  // est pire. `solde` etait dans ce cas.
  { fichier: "lib/server/clients.ts", modele: "Client" },
] as const;

describe.each(FACADES)("$fichier aplatit tous les Decimal de $modele", ({ fichier, modele }) => {
  const attendus = colonnesDecimal(modele);

  it("déclare chaque colonne Decimal du schéma", () => {
    const declares = champsConvertis(fichier);
    const oublies = attendus.filter((c) => !declares.includes(c));
    expect(
      oublies,
      `Colonne(s) Decimal absente(s) du type DecimalField de ${fichier}. ` +
        "Sans elles, la valeur traverse la frontière RSC en objet Decimal " +
        "et la page qui la lit échoue à l'exécution.",
    ).toEqual([]);
  });

  it("convertit effectivement chacune d'elles", () => {
    const declares = champsConvertis(fichier);
    const convertis = conversionsEffectives(fichier, declares);
    const declaresMaisNonConvertis = declares.filter((c) => !convertis.includes(c));
    expect(
      declaresMaisNonConvertis,
      `Champ(s) listé(s) dans DecimalField mais jamais passé(s) par Number() dans ${fichier}. ` +
        "Le type ment alors sur la forme réelle de l'objet renvoyé.",
    ).toEqual([]);
  });
});

describe("le schéma reste la source de vérité", () => {
  it("détecte bien les colonnes Decimal", () => {
    // Garde-fou du test lui-même : si la lecture du schéma cassait, les
    // assertions ci-dessus passeraient sur des listes vides.
    expect(colonnesDecimal("CatalogueProduit")).toContain("prixVenteIndicatif");
    expect(colonnesDecimal("Product")).toContain("purchasePrice");
    expect(colonnesDecimal("CatalogueProduit").length).toBeGreaterThan(5);
  });
});
