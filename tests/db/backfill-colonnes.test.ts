import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COPIED_COLUMNS, COLONNES_A_RATTRAPER } from "@/prisma/backfill-pharmacy-stock";

/**
 * `pharmacy_stock` porte une copie complète de la fiche catalogue. Trois
 * listes doivent rester d'accord entre elles et avec le schéma :
 *
 *   1. les colonnes de `pharmacy_stock` qui existent aussi sur
 *      `catalogue_produits` ;
 *   2. `COPIED_COLUMNS`, ce que le backfill recopie ;
 *   3. `catalogueSnapshot()`, ce que le flux d'ajout au stock recopie.
 *
 * Une colonne ajoutée au schéma sans être ajoutée aux deux autres reste
 * vide pour toujours, sans que rien ne le signale : ni `tsc`, ni le build,
 * ni l'interface — la valeur manque simplement. C'est arrivé avec
 * `prix_vente_indicatif`. Ce test compare les trois.
 */

const racine = resolve(__dirname, "../..");
const schema = readFileSync(resolve(racine, "prisma/schema.prisma"), "utf8");

/** `nom String?` ou `prixVenteIndicatif Decimal? @map("prix_vente_indicatif")`. */
function colonnesDe(modele: string): Map<string, string> {
  const bloc = new RegExp(`^model ${modele} \\{(.*?)^\\}`, "ms").exec(schema);
  if (!bloc) throw new Error(`Modèle ${modele} introuvable`);
  const colonnes = new Map<string, string>();
  for (const ligne of bloc[1]!.split("\n")) {
    const champ = /^\s+(\w+)\s+(String|Decimal|Boolean|Int|DateTime|ProduitCategorie|TableauSubstance)\??/.exec(ligne);
    if (!champ) continue;
    const map = /@map\("([^"]+)"\)/.exec(ligne);
    colonnes.set(champ[1]!, map?.[1] ?? champ[1]!);
  }
  return colonnes;
}

/** Les champs que `catalogueSnapshot()` recopie effectivement. */
function champsDuSnapshot(): string[] {
  const src = readFileSync(resolve(racine, "lib/server/stock-entry.ts"), "utf8");
  const bloc = /function catalogueSnapshot\([\s\S]*?\n\}/.exec(src);
  if (!bloc) throw new Error("catalogueSnapshot introuvable");
  return [...bloc[0].matchAll(/^\s+(\w+): fiche\./gm)].map((m) => m[1]!);
}

/**
 * Ce que les deux mécanismes DEVRAIENT couvrir : toute colonne présente des
 * deux côtés, hors clés, horodatages et champs propres à l'officine.
 */
const HORS_COPIE = new Set([
  "id",
  "pharmacyId",
  "catalogueProduitId",
  "createdAt",
  "updatedAt",
  // Ce qui appartient à l'officine, jamais au catalogue.
  "supplierId",
  "stockMinimum",
  "stockMaximum",
  "dateAjout",
  "referenceInterne",
  "localisation",
  "actifLocalement",
  "margeLibre",
  "prixAchat",
  // Propres au catalogue national : une officine n'a pas de photos
  // partagées ni de statut de commercialisation national à recopier.
  "photos",
  "stocks",
  "produits",
]);

const stock = colonnesDe("PharmacyStock");
const catalogue = colonnesDe("CatalogueProduit");

const aRecopier = [...stock.entries()].filter(
  ([champ]) => !HORS_COPIE.has(champ) && catalogue.has(champ),
);

/**
 * Les colonnes du catalogue qui DEVRAIENT exister sur `pharmacy_stock`.
 *
 * Ce test-ci manquait, et l'omission s'est vue : la migration parapharmacie
 * a posé six colonnes sur `catalogue_produits` et une seule sur
 * `pharmacy_stock`. Les cinq autres étaient invisibles pour les
 * vérifications d'alors, qui ne comparaient que les colonnes **communes** —
 * une colonne absente des deux côtés du filtre n'apparaît nulle part.
 */
describe("pharmacy_stock porte bien toutes les colonnes du catalogue", () => {
  it("aucune colonne du catalogue ne manque à la copie", () => {
    const attendues = [...catalogue.keys()].filter((champ) => !HORS_COPIE.has(champ));
    const absentes = attendues.filter((champ) => !stock.has(champ));
    expect(
      absentes,
      "Colonne(s) présente(s) sur catalogue_produits mais absente(s) de " +
        "pharmacy_stock : la copie est incomplète, et rien d'autre ne le signale.",
    ).toEqual([]);
  });
});

describe("la copie catalogue vers pharmacy_stock reste complète", () => {
  it("le backfill recopie chaque colonne partagée", () => {
    const attendues = aRecopier.map(([, colonne]) => colonne).sort();
    const oubliees = attendues.filter((c) => !COPIED_COLUMNS.includes(c as never));
    expect(
      oubliees,
      "Colonne(s) présente(s) sur pharmacy_stock ET catalogue_produits mais " +
        "absente(s) de COPIED_COLUMNS : le backfill les laissera vides pour toujours.",
    ).toEqual([]);
  });

  it("le flux d'ajout au stock recopie les mêmes", () => {
    const attendus = aRecopier.map(([champ]) => champ).sort();
    const snapshot = champsDuSnapshot();
    const oublies = attendus.filter((champ) => !snapshot.includes(champ));
    expect(
      oublies,
      "Champ(s) absent(s) de catalogueSnapshot() : toute fiche ajoutée au " +
        "stock depuis le catalogue naîtra avec ces colonnes vides.",
    ).toEqual([]);
  });

  it("les deux listes couvrent exactement la même chose", () => {
    expect(COPIED_COLUMNS.length).toBe(champsDuSnapshot().length);
  });

  it("aucune colonne rattrapée n'a été oubliée dans la liste principale", () => {
    for (const colonne of COLONNES_A_RATTRAPER) {
      expect(COPIED_COLUMNS).toContain(colonne);
    }
  });

  it("ne recopie jamais ce qui appartient à l'officine", () => {
    for (const propre of ["stock_minimum", "reference_interne", "localisation", "prix_achat"]) {
      expect(COPIED_COLUMNS).not.toContain(propre);
    }
    expect(champsDuSnapshot()).not.toContain("stockMinimum");
    expect(champsDuSnapshot()).not.toContain("prixAchat");
  });

  it("lit bien le schéma — garde-fou du test lui-même", () => {
    expect(stock.get("prixVenteIndicatif")).toBe("prix_vente_indicatif");
    expect(aRecopier.length).toBeGreaterThan(30);
  });
});
