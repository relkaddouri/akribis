import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  detectDelimiter,
  parseCsv,
  parseSpreadsheet,
  parseXlsx,
  SpreadsheetError,
  columnIndex,
} from "@/lib/catalogue/spreadsheet";
import {
  autoMapColumns,
  missingRequiredFields,
  parseAmount,
  planImport,
  unmappedColumns,
} from "@/lib/catalogue/import-mapping";

/**
 * `cnops-extrait.xlsx` is the first 12 rows of the real
 * « Réf. des médicaments CNOPS 2014 » workbook, re-zipped with only the
 * shared strings those rows use. Structure untouched — the point is to
 * test against a file Excel actually produced, not one we generated.
 */
const CNOPS = readFileSync(resolve(__dirname, "../fixtures/cnops-extrait.xlsx"));

describe("lecture d'un classeur Excel", () => {
  it("retrouve les douze colonnes du référentiel CNOPS", () => {
    const sheet = parseXlsx(CNOPS);
    expect(sheet.headers).toEqual([
      "CODE",
      "NOM",
      "DCI1",
      "DOSAGE1",
      "UNITE_DOSAGE1",
      "FORME",
      "PRESENTATION",
      "PPV",
      "PH",
      "PRIX_BR",
      "PRINCEPS_GENERIQUE",
      "TAUX_REMBOURSEMENT",
    ]);
    expect(sheet.rows).toHaveLength(12);
  });

  it("lit une ligne de bout en bout", () => {
    const [first] = parseXlsx(CNOPS).rows;
    expect(first).toEqual([
      "6118001230068",
      "URO / EAU POUR IRRIGATION",
      "EAU POUR PREPARATION INJECTABLE",
      "3000",
      "ML",
      "SOLUTION POUR IRRIGATION",
      "1 POCHE 3 L",
      "95",
      "0",
      "95",
      "P",
      "0%",
    ]);
  });

  it("refuse un fichier qui n'est pas un classeur", () => {
    expect(() => parseXlsx(Buffer.from("ceci n'est pas un zip"))).toThrow(SpreadsheetError);
  });

  it("oriente vers .xlsx quand on lui donne un vieux .xls", () => {
    expect(() => parseSpreadsheet("ref.xls", CNOPS)).toThrow(/97-2003/);
  });

  it("choisit le lecteur d'après l'extension", () => {
    expect(parseSpreadsheet("ref.xlsx", CNOPS).rows).toHaveLength(12);
    expect(parseSpreadsheet("ref.csv", Buffer.from("a,b\n1,2")).headers).toEqual(["a", "b"]);
    expect(() => parseSpreadsheet("ref.pdf", CNOPS)).toThrow(/Format non reconnu/);
  });
});

describe("lecture d'un CSV", () => {
  it("comprend les guillemets, les séparateurs inclus et les sauts de ligne", () => {
    const sheet = parseCsv('nom,forme\n"DOLIPRANE 500, boîte de 16",Comprimé\n"Ligne\navec retour",Sirop');
    expect(sheet.rows).toEqual([
      ["DOLIPRANE 500, boîte de 16", "Comprimé"],
      ["Ligne\navec retour", "Sirop"],
    ]);
  });

  it("comprend le point-virgule des exports Excel français", () => {
    expect(detectDelimiter("nom;forme;ppv")).toBe(";");
    expect(parseCsv("nom;forme\nDOLIPRANE;Comprimé").rows).toEqual([["DOLIPRANE", "Comprimé"]]);
  });

  /** Un `,` à l'intérieur d'un champ cité ne doit pas l'emporter sur le vrai séparateur. */
  it("ne se laisse pas tromper par une virgule entre guillemets", () => {
    expect(detectDelimiter('"nom, complet";forme;ppv')).toBe(";");
  });

  it("gère le BOM, les CRLF et l'absence de saut de ligne final", () => {
    const sheet = parseCsv("﻿nom,forme\r\nDOLIPRANE,Comprimé\r\nEFFERALGAN,Sachet");
    expect(sheet.headers).toEqual(["nom", "forme"]);
    expect(sheet.rows).toHaveLength(2);
  });

  it("restitue les guillemets échappés", () => {
    expect(parseCsv('nom\n"Sirop ""pédiatrique"""').rows).toEqual([['Sirop "pédiatrique"']]);
  });

  it("ignore les lignes vides plutôt que de les compter comme des produits", () => {
    expect(parseCsv("nom,forme\nA,B\n\n\nC,D\n").rows).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
  });

  it("refuse un fichier sans aucune ligne exploitable", () => {
    expect(() => parseCsv("\n\n")).toThrow(SpreadsheetError);
  });
});

describe("colonnes manquantes au milieu d'une ligne", () => {
  /**
   * Excel n'écrit pas les cellules vides : une ligne dont B est vide passe
   * de A à C. Sans lecture de la référence de cellule, tout ce qui suit
   * décale d'une colonne — le PPV atterrirait dans le PPH.
   */
  it("place chaque valeur d'après sa référence de cellule, pas son rang", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("C7")).toBe(2);
    expect(columnIndex("AA1")).toBe(26);
    expect(columnIndex("AB100")).toBe(27);
  });
});

describe("détection automatique des colonnes", () => {
  const headers = parseXlsx(CNOPS).headers;

  it("reconnaît le référentiel CNOPS sans intervention", () => {
    const mapping = autoMapColumns(headers);
    expect(mapping).toMatchObject({
      codeBarres: 0,
      nom: 1,
      dci: 2,
      dosage: 3,
      dosageUnite: 4,
      formeGalenique: 5,
      conditionnement: 6,
      ppv: 7,
      pph: 8,
      prixBaseRemboursement: 9,
      tauxRemboursement: 11,
    });
    expect(missingRequiredFields(mapping)).toEqual([]);
  });

  it("signale PRINCEPS_GENERIQUE comme non repris", () => {
    // Le schéma n'a pas de champ princeps/générique : la colonne est
    // affichée comme ignorée plutôt que rangée dans un champ approchant.
    expect(unmappedColumns(headers, autoMapColumns(headers))).toEqual(["PRINCEPS_GENERIQUE"]);
  });

  it("tolère accents, espaces et casse dans les en-têtes", () => {
    const mapping = autoMapColumns(["Code-barres", "Nom ", "FORME GALÉNIQUE", "P.P.V"]);
    expect(mapping.codeBarres).toBe(0);
    expect(mapping.nom).toBe(1);
    expect(mapping.formeGalenique).toBe(2);
    expect(mapping.ppv).toBe(3);
  });

  /** PPH dans la colonne PPV mettrait de faux prix nationaux sans que personne ne le voie. */
  it("ne devine pas au rapprochement approximatif", () => {
    const mapping = autoMapColumns(["prix", "montant", "valeur"]);
    expect(mapping.ppv).toBeNull();
    expect(mapping.pph).toBeNull();
  });

  it("réclame les colonnes indispensables quand elles manquent", () => {
    const manquantes = missingRequiredFields(autoMapColumns(["NOM", "DCI1"]));
    expect(manquantes.map((field) => field.key).sort()).toEqual(["codeBarres", "formeGalenique"]);
  });
});

describe("lecture des montants", () => {
  it("nettoie ce que les tableurs produisent réellement", () => {
    expect(parseAmount("18.100000000000001")).toBe(18.1); // bruit flottant Excel
    expect(parseAmount("1 234,56")).toBe(1234.56); // virgule + espace milliers
    expect(parseAmount("70%")).toBe(70);
    expect(parseAmount("95")).toBe(95);
    expect(parseAmount("0")).toBe(0);
  });

  it("renvoie null plutôt qu'un NaN silencieux", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("N/A")).toBeNull();
    expect(parseAmount("-")).toBeNull();
  });
});

describe("plan d'import", () => {
  const sheet = parseXlsx(CNOPS);
  const mapping = autoMapColumns(sheet.headers);

  it("prépare les douze lignes quand le catalogue est vide", () => {
    const plan = planImport({ sheet, mapping, existingBarcodes: new Set() });
    expect(plan.lues).toBe(12);
    expect(plan.aCreer).toHaveLength(12);
    expect(plan.doublons).toEqual([]);
    expect(plan.rejets).toEqual([]);
  });

  it("recompose le dosage à partir de la valeur et de son unité", () => {
    const plan = planImport({ sheet, mapping, existingBarcodes: new Set() });
    expect(plan.aCreer[0]!.dosage).toBe("3000 ML");
    expect(plan.aCreer[1]!.dosage).toBe("200 MG");
  });

  it("déduit « remboursable » du taux, et 0 % veut dire non", () => {
    const plan = planImport({ sheet, mapping, existingBarcodes: new Set() });
    const irrigation = plan.aCreer.find((row) => row.codeBarres === "6118001230068")!;
    const eloxatine = plan.aCreer.find((row) => row.codeBarres === "6118010116230")!;

    expect(irrigation.tauxRemboursement).toBe(0);
    expect(irrigation.remboursable).toBe(false);
    expect(eloxatine.tauxRemboursement).toBe(70);
    expect(eloxatine.remboursable).toBe(true);
  });

  it("range PRIX_BR dans le montant, jamais dans le taux", () => {
    const plan = planImport({ sheet, mapping, existingBarcodes: new Set() });
    const eloxatine = plan.aCreer.find((row) => row.codeBarres === "6118010116230")!;
    expect(eloxatine.prixBaseRemboursement).toBe(2882);
    expect(eloxatine.ppv).toBe(2882);
    expect(eloxatine.pph).toBe(2555);
  });

  it("applique la catégorie choisie à toutes les lignes", () => {
    const plan = planImport({
      sheet,
      mapping,
      existingBarcodes: new Set(),
      categorie: "PHARMACEUTIQUE",
    });
    expect(plan.aCreer.every((row) => row.categorie === "PHARMACEUTIQUE")).toBe(true);
  });

  it("écarte ce qui est déjà au catalogue, sans l'écraser", () => {
    const plan = planImport({
      sheet,
      mapping,
      existingBarcodes: new Set(["6118001230068", "6118010116230"]),
    });
    expect(plan.aCreer).toHaveLength(10);
    expect(plan.doublons).toHaveLength(2);
    expect(plan.doublons.every((duplicate) => duplicate.origine === "catalogue")).toBe(true);
    expect(plan.lues).toBe(12);
  });

  it("écarte aussi un code-barres répété dans le fichier lui-même", () => {
    const doubled = {
      headers: ["CODE", "NOM", "FORME"],
      rows: [
        ["6111111111111", "A", "Comprimé"],
        ["6111111111111", "A (doublon)", "Comprimé"],
      ],
    };
    const plan = planImport({
      sheet: doubled,
      mapping: { codeBarres: 0, nom: 1, formeGalenique: 2 },
      existingBarcodes: new Set(),
    });
    expect(plan.aCreer).toHaveLength(1);
    expect(plan.doublons).toEqual([
      { ligne: 3, codeBarres: "6111111111111", nom: "A (doublon)", origine: "fichier" },
    ]);
  });

  it("rejette les lignes inexploitables en donnant le numéro de ligne du tableur", () => {
    const messy = {
      headers: ["CODE", "NOM", "FORME", "PPV"],
      rows: [
        ["6111111111111", "Bon produit", "Comprimé", "12,50"],
        ["", "Sans code", "Comprimé", "10"],
        ["6111111111112", "", "Comprimé", "10"],
        ["ABC", "Code non numérique", "Comprimé", "10"],
        ["6111111111113", "Sans forme", "", "10"],
        ["6111111111114", "Prix illisible", "Comprimé", "douze"],
      ],
    };
    const plan = planImport({
      sheet: messy,
      mapping: { codeBarres: 0, nom: 1, formeGalenique: 2, ppv: 3 },
      existingBarcodes: new Set(),
    });

    expect(plan.aCreer).toHaveLength(1);
    expect(plan.aCreer[0]!.ppv).toBe(12.5);
    expect(plan.rejets.map((rejection) => rejection.ligne)).toEqual([3, 4, 5, 6, 7]);
    expect(plan.rejets[0]!.motif).toMatch(/Nom absent|Code-barres absent/);
    expect(plan.rejets[2]!.motif).toMatch(/Code-barres invalide/);
    expect(plan.rejets[4]!.motif).toMatch(/illisible/);
  });

  it("compte chaque ligne lue une fois et une seule", () => {
    const plan = planImport({
      sheet,
      mapping,
      existingBarcodes: new Set(["6118001230068"]),
    });
    expect(plan.aCreer.length + plan.doublons.length + plan.rejets.length).toBe(plan.lues);
  });

  it("ne lit rien d'une colonne non mappée", () => {
    const plan = planImport({
      sheet,
      mapping: { ...mapping, ppv: null, laboratoire: null },
      existingBarcodes: new Set(),
    });
    expect(plan.aCreer.every((row) => row.ppv === null)).toBe(true);
    expect(plan.aCreer.every((row) => row.laboratoire === null)).toBe(true);
    expect(plan.aCreer).toHaveLength(12);
  });
});
