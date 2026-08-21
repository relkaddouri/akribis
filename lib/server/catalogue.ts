"use server";

/**
 * Prisma-backed facade for the national product catalogue — the Akribis
 * back-office only.
 *
 * Nothing here is scoped by pharmacy, because `catalogue_produits` isn't:
 * one fiche is shared by every officine on the platform. That is exactly
 * why every entry point starts with `requireAdmin()`. A server action is
 * reachable by POST without ever loading a page, so the middleware's route
 * guard cannot be the only check — see tests/admin/access-control.test.ts.
 *
 * This module deliberately does not touch `products`, `pharmacy_stock` or
 * `product_lots`: the pharmacy side still reads `products`, and the
 * switch-over is a later phase (docs/migration-catalogue.md).
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { requireAdmin } from "@/lib/auth/session";
import { ADMIN_CATALOGUE_PATH } from "@/lib/auth/access-control";
import {
  catalogueFormSchema,
  type CatalogueFormInput,
  type ProduitCategorieValue,
} from "@/lib/validations/catalogue";
import { parseSpreadsheet, SpreadsheetError } from "@/lib/catalogue/spreadsheet";
import { renumber } from "@/lib/catalogue/photo-rules";
import { isToggleableFlag, type CatalogueFlag } from "@/lib/catalogue/flags";
import {
  autoMapColumns,
  missingRequiredFields,
  planImport,
  unmappedColumns,
  type ColumnMapping,
  type ImportDuplicate,
  type ImportRejection,
} from "@/lib/catalogue/import-mapping";
import {
  toCatalogueRecord as toRecord,
  type CatalogueProduitRecord,
  type CataloguePhotoRecord,
} from "@/lib/catalogue/record";

// Ré-exportés pour les huit fichiers qui les importent déjà d'ici. Les
// exports de type disparaissent à la compilation : la règle « un fichier
// "use server" n'exporte que des fonctions asynchrones » ne les concerne pas.
export type { CatalogueProduitRecord, CataloguePhotoRecord };


/**
 * Ordered by `ordre`, then by insertion date so ties resolve the same way
 * every time — the first element is the photo principale.
 */
const PHOTO_SELECT = {
  select: { id: true, url: true, ordre: true },
  orderBy: [{ ordre: "asc" as const }, { dateAjout: "asc" as const }],
};

export async function listCatalogueProduits(): Promise<CatalogueProduitRecord[]> {
  await requireAdmin();
  const produits = await prisma.catalogueProduit.findMany({
    orderBy: { nom: "asc" },
    // Only the first photo per fiche is ever shown in the list, but Prisma
    // cannot LIMIT a nested relation per parent; the rows are two columns
    // wide and most fiches have none, so fetching them all is cheaper than
    // a second round trip.
    include: { photos: PHOTO_SELECT },
  });
  return produits.map(toRecord);
}

export async function getCatalogueProduit(id: string): Promise<CatalogueProduitRecord | null> {
  await requireAdmin();
  const produit = await prisma.catalogueProduit.findUnique({
    where: { id },
    include: { photos: PHOTO_SELECT },
  });
  return produit ? toRecord(produit) : null;
}

/** Distinct laboratoires/DCI present in the catalogue — feeds the table filters. */
export async function listCatalogueFacets(): Promise<{
  laboratoires: string[];
  dci: string[];
}> {
  await requireAdmin();
  const [laboratoires, dci] = await Promise.all([
    prisma.catalogueProduit.findMany({
      where: { laboratoire: { not: null } },
      distinct: ["laboratoire"],
      select: { laboratoire: true },
      orderBy: { laboratoire: "asc" },
    }),
    prisma.catalogueProduit.findMany({
      where: { dci: { not: null } },
      distinct: ["dci"],
      select: { dci: true },
      orderBy: { dci: "asc" },
    }),
  ]);

  return {
    laboratoires: laboratoires.map((row) => row.laboratoire!).filter(Boolean),
    dci: dci.map((row) => row.dci!).filter(Boolean),
  };
}

export type CatalogueActionResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * The unique index on `code_barres` is what keeps one national fiche per
 * product. Catching its violation rather than pre-checking: a pre-check
 * would still lose a race between two admins saving at once.
 */
function duplicateBarcodeMessage(error: unknown, codeBarres: string | null): string | null {
  const code = (error as { code?: string } | null)?.code;
  if (code !== "P2002" || !codeBarres) return null;
  return `Le code-barres ${codeBarres} est déjà utilisé par une autre fiche du catalogue.`;
}

export async function createCatalogueProduit(
  input: CatalogueFormInput,
): Promise<CatalogueActionResult> {
  await requireAdmin();

  const parsed = catalogueFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  }

  const { photos, ...fields } = parsed.data;

  try {
    const produit = await prisma.catalogueProduit.create({
      data: { ...fields, photos: { create: renumber(photos) } },
    });
    revalidatePath(ADMIN_CATALOGUE_PATH);
    return { ok: true, id: produit.id };
  } catch (error) {
    const message = duplicateBarcodeMessage(error, parsed.data.codeBarres);
    if (message) return { ok: false, error: message };
    throw error;
  }
}

export async function updateCatalogueProduit(
  id: string,
  input: CatalogueFormInput,
): Promise<CatalogueActionResult> {
  await requireAdmin();

  const parsed = catalogueFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  }

  const { photos, ...fields } = parsed.data;

  try {
    // Photos are replaced wholesale inside the same transaction as the
    // fields: the form hands over the list it wants to end up with, and
    // reconciling row by row would be more code for an identical result
    // on a set that never exceeds six.
    await prisma.$transaction([
      prisma.catalogueProduitPhoto.deleteMany({ where: { catalogueProduitId: id } }),
      prisma.catalogueProduit.update({
        where: { id },
        data: { ...fields, photos: { create: renumber(photos) } },
      }),
    ]);
    revalidatePath(ADMIN_CATALOGUE_PATH);
    revalidatePath(`${ADMIN_CATALOGUE_PATH}/${id}`);
    return { ok: true, id };
  } catch (error) {
    const message = duplicateBarcodeMessage(error, parsed.data.codeBarres);
    if (message) return { ok: false, error: message };
    throw error;
  }
}

/**
 * Deactivation, never deletion — PRD point 4. A fiche is referenced by
 * `pharmacy_stock` rows and, through them, by past sales: removing it
 * would break the traceability those records exist for. `actifCatalogue`
 * false means "no longer offered", and the row stays readable for ever.
 */
export async function setCatalogueProduitActif(
  id: string,
  actif: boolean,
): Promise<CatalogueActionResult> {
  return setCatalogueProduitFlag(id, "actifCatalogue", actif);
}

export async function setCatalogueProduitFlag(
  id: string,
  flag: CatalogueFlag,
  value: boolean,
): Promise<CatalogueActionResult> {
  await requireAdmin();

  // Re-checked server-side even though the parameter is typed: the type
  // is erased at the network boundary, and this action is reachable by POST.
  if (!isToggleableFlag(flag)) {
    return { ok: false, error: "Champ non modifiable." };
  }

  await prisma.catalogueProduit.update({ where: { id }, data: { [flag]: value } });
  revalidatePath(ADMIN_CATALOGUE_PATH);
  revalidatePath(`${ADMIN_CATALOGUE_PATH}/${id}`);
  return { ok: true, id };
}

export type CatalogueNeighbour = { id: string; nom: string };

/**
 * Previous and next fiche in the catalogue's own order (nom, then id to
 * break ties) — the same order the list uses, so "next" means what the
 * admin just saw one row below.
 *
 * Two indexed lookups rather than loading the list: at 5 900 fiches,
 * paging through them to find a neighbour would cost more than the page.
 */
export async function getCatalogueNeighbours(id: string): Promise<{
  precedent: CatalogueNeighbour | null;
  suivant: CatalogueNeighbour | null;
}> {
  await requireAdmin();

  const current = await prisma.catalogueProduit.findUnique({
    where: { id },
    select: { id: true, nom: true },
  });
  if (!current) return { precedent: null, suivant: null };

  const select = { id: true, nom: true };
  const [precedent, suivant] = await Promise.all([
    prisma.catalogueProduit.findFirst({
      where: {
        OR: [{ nom: { lt: current.nom } }, { nom: current.nom, id: { lt: current.id } }],
      },
      orderBy: [{ nom: "desc" }, { id: "desc" }],
      select,
    }),
    prisma.catalogueProduit.findFirst({
      where: {
        OR: [{ nom: { gt: current.nom } }, { nom: current.nom, id: { gt: current.id } }],
      },
      orderBy: [{ nom: "asc" }, { id: "asc" }],
      select,
    }),
  ]);

  return { precedent, suivant };
}

// ------------------------------------------------------------ Import

export type ImportPreview = {
  ok: true;
  fileName: string;
  headers: string[];
  /** First rows as read, so the admin can confirm the mapping is right. */
  apercu: string[][];
  mapping: ColumnMapping;
  colonnesIgnorees: string[];
  champsManquants: { key: string; label: string }[];
  lues: number;
  aCreer: number;
  doublons: ImportDuplicate[];
  rejets: ImportRejection[];
};

export type ImportFailure = { ok: false; error: string };

const MAX_PREVIEW_ROWS = 8;
/** Beyond this, the report itself would be unreadable — the counts still are. */
const MAX_REPORTED_ROWS = 200;

async function readUpload(formData: FormData): Promise<{ name: string; buffer: Buffer } | null> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  return { name: file.name, buffer: Buffer.from(await file.arrayBuffer()) };
}

async function existingBarcodes(): Promise<Set<string>> {
  const rows = await prisma.catalogueProduit.findMany({
    where: { codeBarres: { not: null } },
    select: { codeBarres: true },
  });
  return new Set(rows.map((row) => row.codeBarres!));
}

function parseMapping(raw: FormDataEntryValue | null): ColumnMapping | null {
  if (typeof raw !== "string" || raw === "") return null;
  try {
    return JSON.parse(raw) as ColumnMapping;
  } catch {
    return null;
  }
}

/**
 * Step 1 — read the file, propose a mapping, and say exactly what would
 * happen. Writes nothing. The admin then confirms (possibly with a
 * corrected mapping), and the file is uploaded a second time: keeping a
 * parsed 5 900-row referential in server memory between two requests
 * would be state we'd have to expire, and re-reading costs nothing.
 */
export async function analyseCatalogueImport(
  formData: FormData,
): Promise<ImportPreview | ImportFailure> {
  await requireAdmin();

  const upload = await readUpload(formData);
  if (!upload) return { ok: false, error: "Aucun fichier reçu." };

  let sheet;
  try {
    sheet = parseSpreadsheet(upload.name, upload.buffer);
  } catch (error) {
    if (error instanceof SpreadsheetError) return { ok: false, error: error.message };
    throw error;
  }

  const mapping = parseMapping(formData.get("mapping")) ?? autoMapColumns(sheet.headers);
  const categorie = (formData.get("categorie") as ProduitCategorieValue | null) || null;
  const plan = planImport({ sheet, mapping, existingBarcodes: await existingBarcodes(), categorie });

  return {
    ok: true,
    fileName: upload.name,
    headers: sheet.headers,
    apercu: sheet.rows.slice(0, MAX_PREVIEW_ROWS),
    mapping,
    colonnesIgnorees: unmappedColumns(sheet.headers, mapping),
    champsManquants: missingRequiredFields(mapping).map((field) => ({
      key: field.key,
      label: field.label,
    })),
    lues: plan.lues,
    aCreer: plan.aCreer.length,
    doublons: plan.doublons.slice(0, MAX_REPORTED_ROWS),
    rejets: plan.rejets.slice(0, MAX_REPORTED_ROWS),
  };
}

export type ImportReport = {
  ok: true;
  crees: number;
  ignoresDoublons: number;
  enErreur: number;
  doublons: ImportDuplicate[];
  rejets: ImportRejection[];
};

/** Postgres caps a statement at 65 535 parameters; ~20 columns per row. */
const INSERT_CHUNK = 500;

/**
 * Step 2 — actually import. Duplicates are skipped, never updated: an
 * import that silently rewrote national prices would leave no trace of
 * what changed.
 */
export async function runCatalogueImport(
  formData: FormData,
): Promise<ImportReport | ImportFailure> {
  await requireAdmin();

  const upload = await readUpload(formData);
  if (!upload) return { ok: false, error: "Aucun fichier reçu." };

  const mapping = parseMapping(formData.get("mapping"));
  if (!mapping) return { ok: false, error: "Correspondance des colonnes manquante." };

  const manquants = missingRequiredFields(mapping);
  if (manquants.length > 0) {
    return {
      ok: false,
      error: `Colonnes obligatoires non renseignées : ${manquants.map((f) => f.label).join(", ")}.`,
    };
  }

  let sheet;
  try {
    sheet = parseSpreadsheet(upload.name, upload.buffer);
  } catch (error) {
    if (error instanceof SpreadsheetError) return { ok: false, error: error.message };
    throw error;
  }

  const categorie = (formData.get("categorie") as ProduitCategorieValue | null) || null;
  const plan = planImport({ sheet, mapping, existingBarcodes: await existingBarcodes(), categorie });

  let crees = 0;
  for (let start = 0; start < plan.aCreer.length; start += INSERT_CHUNK) {
    const chunk = plan.aCreer.slice(start, start + INSERT_CHUNK);
    const result = await prisma.catalogueProduit.createMany({
      data: chunk,
      // Belt and braces against the unique index: the plan already
      // filtered known barcodes, but another admin may have imported the
      // same referential while this one was reviewing the preview.
      skipDuplicates: true,
    });
    crees += result.count;
  }

  revalidatePath(ADMIN_CATALOGUE_PATH);

  return {
    ok: true,
    crees,
    // Rows the plan skipped, plus any the unique index caught mid-flight.
    ignoresDoublons: plan.doublons.length + (plan.aCreer.length - crees),
    enErreur: plan.rejets.length,
    doublons: plan.doublons.slice(0, MAX_REPORTED_ROWS),
    rejets: plan.rejets.slice(0, MAX_REPORTED_ROWS),
  };
}
