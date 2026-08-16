/**
 * Turns a parsed spreadsheet into catalogue rows ready to insert.
 *
 * Modelled on the CNOPS 2014 referential — CODE, NOM, DCI1, DOSAGE1,
 * UNITE_DOSAGE1, FORME, PRESENTATION, PPV, PH, PRIX_BR,
 * PRINCEPS_GENERIQUE, TAUX_REMBOURSEMENT — but nothing here assumes those
 * exact headers: the admin confirms or changes every column mapping before
 * anything is written. Auto-detection is a starting point, not a contract.
 *
 * Pure functions, no database and no I/O, so the whole import decision —
 * what gets created, what is a duplicate, what is rejected — is testable
 * without a connection.
 */

import type { Sheet } from "@/lib/catalogue/spreadsheet";
import type { ProduitCategorieValue } from "@/lib/validations/catalogue";

export type ImportFieldKey =
  | "codeBarres"
  | "nom"
  | "dci"
  | "dosage"
  | "dosageUnite"
  | "formeGalenique"
  | "conditionnement"
  | "laboratoire"
  | "classeTherapeutique"
  | "ppv"
  | "pph"
  | "prixBaseRemboursement"
  | "tauxRemboursement";

export type ImportField = {
  key: ImportFieldKey;
  label: string;
  /** Without it, the row cannot be imported at all. */
  required?: boolean;
  hint?: string;
  /** Header names seen in the wild, lowercased and stripped of separators. */
  aliases: string[];
};

export const IMPORT_FIELDS: ImportField[] = [
  {
    key: "codeBarres",
    label: "Code-barres",
    required: true,
    hint: "CIP/CBO 13 chiffres — sert à repérer les doublons",
    aliases: ["code", "codebarres", "codebarre", "cip", "cbo", "ean", "ean13", "codeean"],
  },
  { key: "nom", label: "Nom", required: true, aliases: ["nom", "libelle", "designation", "produit", "name"] },
  {
    key: "formeGalenique",
    label: "Forme galénique",
    required: true,
    aliases: ["forme", "formegalenique", "galenique"],
  },
  { key: "dci", label: "DCI", aliases: ["dci", "dci1", "substance", "principeactif"] },
  { key: "dosage", label: "Dosage", aliases: ["dosage", "dosage1", "dose"] },
  {
    key: "dosageUnite",
    label: "Unité de dosage",
    hint: "Accolée au dosage : « 500 » + « MG » donne « 500 MG »",
    aliases: ["unitedosage", "unitedosage1", "unite", "unit"],
  },
  {
    key: "conditionnement",
    label: "Conditionnement",
    aliases: ["presentation", "conditionnement", "packaging", "boite"],
  },
  { key: "laboratoire", label: "Laboratoire", aliases: ["laboratoire", "labo", "fabricant", "titulaire"] },
  {
    key: "classeTherapeutique",
    label: "Classe thérapeutique",
    aliases: ["classetherapeutique", "classe", "categorietherapeutique"],
  },
  { key: "ppv", label: "PPV", hint: "Prix public de vente", aliases: ["ppv", "prixpublic", "prixventepublic"] },
  { key: "pph", label: "PPH", hint: "Prix pharmacien hors taxe", aliases: ["ph", "pph", "prixpharmacien"] },
  {
    key: "prixBaseRemboursement",
    label: "Prix base remboursement",
    hint: "Un montant, pas un taux",
    aliases: ["prixbr", "basederemboursement", "prixbaseremboursement", "br"],
  },
  {
    key: "tauxRemboursement",
    label: "Taux de remboursement",
    hint: "En %, « 70% » ou « 70 »",
    aliases: ["tauxremboursement", "taux", "tauxrembours", "remboursement"],
  },
];

/** Column index per field, or null when the file has no column for it. */
export type ColumnMapping = Partial<Record<ImportFieldKey, number | null>>;

function normaliseHeader(header: string): string {
  return header
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Best-effort column mapping from the header row. Exact alias match only —
 * a fuzzy match that silently maps PPH onto PPV would put wrong prices in
 * the national catalogue, and the admin would have no reason to look.
 */
export function autoMapColumns(headers: string[]): ColumnMapping {
  const normalised = headers.map(normaliseHeader);
  const mapping: ColumnMapping = {};
  const taken = new Set<number>();

  for (const field of IMPORT_FIELDS) {
    const index = normalised.findIndex(
      (header, position) => !taken.has(position) && field.aliases.includes(header),
    );
    mapping[field.key] = index === -1 ? null : index;
    if (index !== -1) taken.add(index);
  }

  return mapping;
}

/** Columns the file has that no field claims — shown as "ignorée". */
export function unmappedColumns(headers: string[], mapping: ColumnMapping): string[] {
  const used = new Set(Object.values(mapping).filter((value): value is number => value !== null));
  return headers.filter((_, index) => !used.has(index));
}

/**
 * Accepts what spreadsheets actually contain: French decimal commas,
 * thousands spaces, a trailing %, and the float noise Excel leaves behind
 * (the CNOPS file stores a 18,10 DH price as 18.100000000000001).
 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw
    .replace(/\s| /g, "")
    .replace(/%$/, "")
    .replace(/,/g, ".");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

export type CatalogueImportRow = {
  codeBarres: string;
  nom: string;
  formeGalenique: string;
  dci: string | null;
  dosage: string | null;
  conditionnement: string | null;
  laboratoire: string | null;
  classeTherapeutique: string | null;
  categorie: ProduitCategorieValue | null;
  ppv: number | null;
  pph: number | null;
  prixBaseRemboursement: number | null;
  tauxRemboursement: number | null;
  remboursable: boolean;
};

export type ImportRejection = {
  /** 1-based, counting the header — matches what the admin sees in Excel. */
  ligne: number;
  motif: string;
};

export type ImportDuplicate = {
  ligne: number;
  codeBarres: string;
  nom: string;
  /** Already in the catalogue, or appearing twice in this same file. */
  origine: "catalogue" | "fichier";
};

export type ImportPlan = {
  aCreer: CatalogueImportRow[];
  doublons: ImportDuplicate[];
  rejets: ImportRejection[];
  /** Total data rows read, = aCreer + doublons + rejets. */
  lues: number;
};

const BARCODE_PATTERN = /^\d{8,14}$/;

/**
 * Decides the whole import without touching the database. `existingBarcodes`
 * is the set already in `catalogue_produits`; duplicates are never updated,
 * only reported — an import that silently overwrote national prices would
 * be impossible to review after the fact.
 */
export function planImport(params: {
  sheet: Sheet;
  mapping: ColumnMapping;
  existingBarcodes: Set<string>;
  /** Applied to every imported row — the CNOPS file has no such column. */
  categorie?: ProduitCategorieValue | null;
}): ImportPlan {
  const { sheet, mapping, existingBarcodes, categorie = null } = params;

  const aCreer: CatalogueImportRow[] = [];
  const doublons: ImportDuplicate[] = [];
  const rejets: ImportRejection[] = [];
  const seenInFile = new Set<string>();

  const read = (row: string[], key: ImportFieldKey): string => {
    const index = mapping[key];
    if (index === null || index === undefined) return "";
    return (row[index] ?? "").trim();
  };

  sheet.rows.forEach((row, position) => {
    const ligne = position + 2; // +1 for the header, +1 for 1-based numbering

    const nom = read(row, "nom");
    const codeBarres = read(row, "codeBarres");
    const formeGalenique = read(row, "formeGalenique");

    if (!nom) {
      rejets.push({ ligne, motif: "Nom absent" });
      return;
    }
    if (!codeBarres) {
      rejets.push({ ligne, motif: "Code-barres absent — impossible de dédoublonner" });
      return;
    }
    if (!BARCODE_PATTERN.test(codeBarres)) {
      rejets.push({ ligne, motif: `Code-barres invalide : « ${codeBarres} » (8 à 14 chiffres)` });
      return;
    }
    if (!formeGalenique) {
      rejets.push({ ligne, motif: "Forme galénique absente" });
      return;
    }

    if (existingBarcodes.has(codeBarres)) {
      doublons.push({ ligne, codeBarres, nom, origine: "catalogue" });
      return;
    }
    if (seenInFile.has(codeBarres)) {
      doublons.push({ ligne, codeBarres, nom, origine: "fichier" });
      return;
    }

    const amounts: Partial<Record<"ppv" | "pph" | "prixBaseRemboursement" | "tauxRemboursement", number | null>> = {};
    let amountError: string | null = null;
    for (const key of ["ppv", "pph", "prixBaseRemboursement", "tauxRemboursement"] as const) {
      const raw = read(row, key);
      if (raw === "") {
        amounts[key] = null;
        continue;
      }
      const value = parseAmount(raw);
      if (value === null) {
        amountError = `${key === "tauxRemboursement" ? "Taux" : "Prix"} illisible : « ${raw} »`;
        break;
      }
      amounts[key] = value;
    }
    if (amountError) {
      rejets.push({ ligne, motif: amountError });
      return;
    }

    const taux = amounts.tauxRemboursement ?? null;
    // "0%" in the CNOPS file means "not reimbursed" — 1977 of its 5917
    // rows. Treating a present-but-zero rate as reimbursable would flag
    // two thousand products as covered when they are not.
    const remboursable = taux !== null && taux > 0;

    const dosageValue = [read(row, "dosage"), read(row, "dosageUnite")].filter(Boolean).join(" ");

    seenInFile.add(codeBarres);
    aCreer.push({
      codeBarres,
      nom,
      formeGalenique,
      dci: read(row, "dci") || null,
      dosage: dosageValue || null,
      conditionnement: read(row, "conditionnement") || null,
      laboratoire: read(row, "laboratoire") || null,
      classeTherapeutique: read(row, "classeTherapeutique") || null,
      categorie,
      ppv: amounts.ppv ?? null,
      pph: amounts.pph ?? null,
      prixBaseRemboursement: amounts.prixBaseRemboursement ?? null,
      tauxRemboursement: taux,
      remboursable,
    });
  });

  return { aCreer, doublons, rejets, lues: sheet.rows.length };
}

/** Fields whose mapping is mandatory before the import button unlocks. */
export function missingRequiredFields(mapping: ColumnMapping): ImportField[] {
  return IMPORT_FIELDS.filter(
    (field) => field.required && (mapping[field.key] === null || mapping[field.key] === undefined),
  );
}
