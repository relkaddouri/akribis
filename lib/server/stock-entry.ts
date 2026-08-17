"use server";

/**
 * Adding a product to a pharmacy's stock, starting from the national
 * catalogue instead of retyping a full fiche.
 *
 * Pharmacy-side, so `requireUser()` — not `requireAdmin()`. Reads of the
 * catalogue are open to any signed-in pharmacist; nothing here writes to
 * `catalogue_produits`, which stays the Akribis back-office's alone.
 *
 * What this creates is deliberately *both*:
 *   - a `products` row, still the operational record the till, receipts,
 *     returns, orders and inventory all read and decrement;
 *   - a `pharmacy_stock` row, the officine's side of the catalogue model,
 *     which is where the switch-over lands later.
 * The `products.catalogueProduitId` link is what ties the two together —
 * see docs/migration-catalogue.md for why the operational table has not
 * moved yet.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { stockEntrySchema, type StockEntryInput } from "@/lib/validations/stock-entry";
import { OPENING_LOT_NUMBER } from "@/lib/catalogue/lots";
import type { CatalogueProduitModel } from "@/lib/db/generated/models";

export type CatalogueSearchHit = {
  id: string;
  nom: string;
  formeGalenique: string;
  dosage: string | null;
  laboratoire: string | null;
  dci: string | null;
  codeBarres: string | null;
  ppv: number | null;
  photoUrl: string | null;
  /** Already in this pharmacy's stock — offer to open it, not to add it twice. */
  dejaEnStock: boolean;
};

const SEARCH_LIMIT = 25;

/**
 * Searches the catalogue by name, barcode or DCI.
 *
 * Inactive fiches are excluded: a product the Akribis team has withdrawn
 * should not be addable to a new stock. Ones already in this pharmacy's
 * stock are kept but flagged — hiding them would leave the pharmacist
 * searching for a product that "isn't in the catalogue" when in fact they
 * already stock it.
 */
export async function searchCatalogue(query: string): Promise<CatalogueSearchHit[]> {
  const user = await requireUser();
  const term = query.trim();
  if (term.length < 2) return [];

  const fiches = await prisma.catalogueProduit.findMany({
    where: {
      actifCatalogue: true,
      OR: [
        { nom: { contains: term, mode: "insensitive" } },
        { codeBarres: { contains: term } },
        { dci: { contains: term, mode: "insensitive" } },
      ],
    },
    orderBy: { nom: "asc" },
    take: SEARCH_LIMIT,
    include: {
      photos: { select: { url: true }, orderBy: [{ ordre: "asc" }, { dateAjout: "asc" }], take: 1 },
      produits: { where: { pharmacyId: user.pharmacyId }, select: { id: true }, take: 1 },
    },
  });

  return fiches.map((fiche) => ({
    id: fiche.id,
    nom: fiche.nom,
    formeGalenique: fiche.formeGalenique,
    dosage: fiche.dosage,
    laboratoire: fiche.laboratoire,
    dci: fiche.dci,
    codeBarres: fiche.codeBarres,
    ppv: fiche.ppv !== null ? Number(fiche.ppv) : null,
    photoUrl: fiche.photos[0]?.url ?? null,
    dejaEnStock: fiche.produits.length > 0,
  }));
}

/** The catalogue fields the short form shows but does not let anyone edit. */
export type CatalogueSummary = CatalogueSearchHit & { pph: number | null };

export async function getCatalogueSummary(id: string): Promise<CatalogueSummary | null> {
  const user = await requireUser();

  const fiche = await prisma.catalogueProduit.findUnique({
    where: { id },
    include: {
      photos: { select: { url: true }, orderBy: [{ ordre: "asc" }, { dateAjout: "asc" }], take: 1 },
      produits: { where: { pharmacyId: user.pharmacyId }, select: { id: true }, take: 1 },
    },
  });
  if (!fiche) return null;

  return {
    id: fiche.id,
    nom: fiche.nom,
    formeGalenique: fiche.formeGalenique,
    dosage: fiche.dosage,
    laboratoire: fiche.laboratoire,
    dci: fiche.dci,
    codeBarres: fiche.codeBarres,
    ppv: fiche.ppv !== null ? Number(fiche.ppv) : null,
    pph: fiche.pph !== null ? Number(fiche.pph) : null,
    photoUrl: fiche.photos[0]?.url ?? null,
    dejaEnStock: fiche.produits.length > 0,
  };
}

/**
 * Les 34 colonnes que `pharmacy_stock` copie du catalogue.
 *
 * Depuis le correctif de conception, `pharmacy_stock` porte sa propre copie
 * modifiable de la fiche plutôt que de la lire à travers
 * `catalogue_produit_id` — voir docs/migration-catalogue.md. Les remplir à
 * la création est ce qui évite de créer des lignes que le backfill ne
 * rattrapera jamais : il ne regarde que les lignes existantes au moment où
 * on le lance.
 *
 * Un instantané, pas un lien : à partir d'ici, l'officine modifie sa copie
 * sans toucher au national, et l'inverse est vrai aussi.
 */
function catalogueSnapshot(fiche: CatalogueProduitModel) {
  return {
    nom: fiche.nom,
    codeBarres: fiche.codeBarres,
    dosage: fiche.dosage,
    categorie: fiche.categorie,
    classeTherapeutique: fiche.classeTherapeutique,
    formeGalenique: fiche.formeGalenique,
    dci: fiche.dci,
    laboratoire: fiche.laboratoire,
    produitTableau: fiche.produitTableau,
    gamme: fiche.gamme,
    sousGamme: fiche.sousGamme,
    necessitePrescription: fiche.necessitePrescription,
    produitCommercialise: fiche.produitCommercialise,
    groupeProduits: fiche.groupeProduits,
    actifCatalogue: fiche.actifCatalogue,
    refrigerationRequise: fiche.refrigerationRequise,
    conditionnement: fiche.conditionnement,
    referenceLabo: fiche.referenceLabo,

    pph: fiche.pph,
    ppv: fiche.ppv,
    prixBaseRemboursement: fiche.prixBaseRemboursement,
    tvaAchat: fiche.tvaAchat,
    tvaVente: fiche.tvaVente,
    remboursable: fiche.remboursable,
    tauxRemboursement: fiche.tauxRemboursement,

    description: fiche.description,
    excipients: fiche.excipients,
    posologieAdulte: fiche.posologieAdulte,
    posologieEnfant: fiche.posologieEnfant,
    indications: fiche.indications,
    contreIndicationConduite: fiche.contreIndicationConduite,
    contreIndicationAllaitement: fiche.contreIndicationAllaitement,
    contreIndicationGrossesse: fiche.contreIndicationGrossesse,
    monographie: fiche.monographie,
  };
}

export type StockEntryResult =
  | { ok: true; productId: string }
  | { ok: false; error: string; productId?: string };

/**
 * Creates the pharmacy's stock entry for a catalogue fiche.
 *
 * The regulated fields are copied from the fiche rather than referenced:
 * the till reads `products`, and it has to keep working offline and with
 * no join. The copy is a snapshot — a later national price change will
 * not silently rewrite what a pharmacy sells at, which is the behaviour
 * we want until the switch-over gives that decision an owner.
 */
export async function addCatalogueProduitToStock(
  input: StockEntryInput,
): Promise<StockEntryResult> {
  const user = await requireUser();

  const parsed = stockEntrySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  }
  const data = parsed.data;

  const fiche = await prisma.catalogueProduit.findUnique({
    where: { id: data.catalogueProduitId },
    include: {
      photos: { select: { url: true }, orderBy: [{ ordre: "asc" }, { dateAjout: "asc" }], take: 1 },
    },
  });
  if (!fiche) return { ok: false, error: "Fiche catalogue introuvable." };
  if (!fiche.actifCatalogue) {
    return { ok: false, error: "Cette fiche a été retirée du catalogue." };
  }

  const existing = await prisma.product.findFirst({
    where: { pharmacyId: user.pharmacyId, catalogueProduitId: fiche.id },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: false,
      error: "Ce produit est déjà dans votre stock.",
      productId: existing.id,
    };
  }

  // Phase 2's migration may already have left a stock line for this fiche.
  // `nom` tells the two cases apart: null means its catalogue copy was
  // never made, so this is the moment to make it.
  const stockDejaLa = await prisma.pharmacyStock.findUnique({
    where: {
      pharmacyId_catalogueProduitId: {
        pharmacyId: user.pharmacyId,
        catalogueProduitId: fiche.id,
      },
    },
    select: { nom: true },
  });

  // The pharmacy's own supplier must belong to the pharmacy — the id comes
  // from a form, so it is never trusted on its own.
  if (data.supplierId) {
    const supplier = await prisma.supplier.findFirst({
      where: { id: data.supplierId, pharmacyId: user.pharmacyId },
      select: { id: true },
    });
    if (!supplier) return { ok: false, error: "Fournisseur inconnu." };
  }

  try {
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          pharmacyId: user.pharmacyId,
          catalogueProduitId: fiche.id,
          // --- copied from the catalogue, not retyped ---
          name: fiche.nom,
          form: fiche.formeGalenique,
          dosage: fiche.dosage,
          laboratory: fiche.laboratoire,
          barcode: fiche.codeBarres,
          dci: fiche.dci,
          photoUrl: fiche.photos[0]?.url ?? null,
          category: fiche.classeTherapeutique,
          // PPV is the regulated public price; with none on file the
          // pharmacist sets it later rather than selling at zero by default.
          price: fiche.ppv ?? 0,
          pph: fiche.pph,
          tvaVente: fiche.tvaVente,
          tvaAchat: fiche.tvaAchat,
          remboursable: fiche.remboursable,
          baseRemboursement: fiche.prixBaseRemboursement,
          posologieAdulte: fiche.posologieAdulte,
          posologieEnfant: fiche.posologieEnfant,
          monographie: fiche.monographie,
          // --- the pharmacy's own ---
          quantityInStock: data.quantiteInitiale,
          lowStockThreshold: data.seuilAlerte,
          purchasePrice: data.prixAchat,
        },
      });

      const stock = await tx.pharmacyStock.upsert({
        where: {
          pharmacyId_catalogueProduitId: {
            pharmacyId: user.pharmacyId,
            catalogueProduitId: fiche.id,
          },
        },
        create: {
          pharmacyId: user.pharmacyId,
          catalogueProduitId: fiche.id,
          ...catalogueSnapshot(fiche),
          supplierId: data.supplierId,
          stockMinimum: data.seuilAlerte,
          referenceInterne: data.referenceInterne,
          localisation: data.localisation,
          prixAchat: data.prixAchat,
        },
        // A row can already exist from the phase-2 migration; the pharmacy
        // is adding the product, so its own fields win.
        //
        // The catalogue copy is only (re)written when it was never made —
        // `nom` null is the same marker the backfill uses. Overwriting it
        // here would silently undo a correction the pharmacy had made to
        // its own copy, which is the one thing the whole split exists to
        // prevent.
        update: {
          ...(stockDejaLa?.nom === null ? catalogueSnapshot(fiche) : {}),
          supplierId: data.supplierId,
          stockMinimum: data.seuilAlerte,
          referenceInterne: data.referenceInterne,
          localisation: data.localisation,
          prixAchat: data.prixAchat,
          actifLocalement: true,
        },
      });

      // The opening quantity is a stock movement like any other, so the
      // history explains where those units came from — and a lot, because
      // in the catalogue model a stock line holds no quantity of its own:
      // it is `SUM(product_lots.quantite)`. Without this the two totals
      // drift apart from the very first product added, which is exactly
      // what `npm run verify:catalogue` started reporting.
      //
      // No lot when the opening quantity is zero: a lot of zero units
      // describes nothing, and the sum is correctly zero without it.
      if (data.quantiteInitiale > 0) {
        await tx.stockMovement.create({
          data: {
            pharmacyId: user.pharmacyId,
            productId: created.id,
            type: "IN",
            quantity: data.quantiteInitiale,
            reason: "Ajout au stock depuis le catalogue",
          },
        });

        await tx.productLot.create({
          data: {
            pharmacyStockId: stock.id,
            numeroLot: OPENING_LOT_NUMBER,
            quantite: data.quantiteInitiale,
          },
        });
      }

      return created;
    });

    revalidatePath("/dashboard/stock");
    return { ok: true, productId: product.id };
  } catch (error) {
    // `products` carries a unique (pharmacyId, barcode): the same physical
    // product may already be in stock under a manually typed fiche.
    if ((error as { code?: string } | null)?.code === "P2002") {
      return {
        ok: false,
        error:
          "Un produit avec ce code-barres existe déjà dans votre stock. " +
          "Ouvrez-le depuis la liste plutôt que d'en créer un second.",
      };
    }
    throw error;
  }
}

export type StockSheet = {
  /** The catalogue fiche behind this product, when it came from one. */
  catalogue: {
    id: string;
    nom: string;
    dci: string | null;
    laboratoire: string | null;
    formeGalenique: string;
    dosage: string | null;
    codeBarres: string | null;
    classeTherapeutique: string | null;
    conditionnement: string | null;
    ppv: number | null;
    pph: number | null;
    tvaVente: number | null;
    tvaAchat: number | null;
    remboursable: boolean;
    tauxRemboursement: number | null;
    prixBaseRemboursement: number | null;
    necessitePrescription: boolean;
    refrigerationRequise: boolean;
    posologieAdulte: string | null;
    posologieEnfant: string | null;
    monographie: string | null;
    actifCatalogue: boolean;
  } | null;
  /** This officine's own row, when the product was added from the catalogue. */
  local: {
    supplierNom: string | null;
    referenceInterne: string | null;
    localisation: string | null;
    stockMinimum: number;
    prixAchat: number | null;
    /** Drives the suggested TVA — para is taxed differently from medicine. */
    categorie: string | null;
    indications: string | null;
    contreIndicationConduite: string | null;
    contreIndicationAllaitement: string | null;
    contreIndicationGrossesse: string | null;
    conditionnement: string | null;
  } | null;
  /** Lots holding units, soonest expiry first. */
  lots: {
    id: string;
    numeroLot: string | null;
    quantite: number;
    datePeremption: Date | null;
  }[];
  /** Catalogue photos, photo principale first. Empty when there are none. */
  photos: { id: string; url: string; ordre: number }[];
};

/**
 * The catalogue fiche and the officine's own row behind a product, for the
 * stock sheet — which shows the two side by side and lets the pharmacy
 * edit only its own.
 *
 * Returns nulls rather than throwing when either is missing: a product
 * typed by hand before this phase has neither, and its sheet must still
 * open.
 */
export async function getStockSheet(productId: string): Promise<StockSheet> {
  const user = await requireUser();

  const product = await prisma.product.findFirst({
    where: { id: productId, pharmacyId: user.pharmacyId },
    select: { catalogueProduitId: true },
  });
  if (!product?.catalogueProduitId) return { catalogue: null, local: null, lots: [], photos: [] };

  const [fiche, stock] = await Promise.all([
    prisma.catalogueProduit.findUnique({
      where: { id: product.catalogueProduitId },
      include: {
        photos: {
          select: { id: true, url: true, ordre: true },
          orderBy: [{ ordre: "asc" }, { dateAjout: "asc" }],
        },
      },
    }),
    prisma.pharmacyStock.findUnique({
      where: {
        pharmacyId_catalogueProduitId: {
          pharmacyId: user.pharmacyId,
          catalogueProduitId: product.catalogueProduitId,
        },
      },
      include: {
        supplier: { select: { name: true } },
        // Seuls les lots qui portent encore des unités : un lot épuisé ne
        // doit pas décider de la prochaine péremption.
        lots: {
          where: { quantite: { gt: 0 } },
          select: { id: true, numeroLot: true, quantite: true, datePeremption: true },
          orderBy: [{ datePeremption: "asc" }, { dateReception: "asc" }],
        },
      },
    }),
  ]);

  const num = (value: unknown) => (value !== null && value !== undefined ? Number(value) : null);

  return {
    catalogue: fiche
      ? {
          id: fiche.id,
          nom: fiche.nom,
          dci: fiche.dci,
          laboratoire: fiche.laboratoire,
          formeGalenique: fiche.formeGalenique,
          dosage: fiche.dosage,
          codeBarres: fiche.codeBarres,
          classeTherapeutique: fiche.classeTherapeutique,
          conditionnement: fiche.conditionnement,
          ppv: num(fiche.ppv),
          pph: num(fiche.pph),
          tvaVente: num(fiche.tvaVente),
          tvaAchat: num(fiche.tvaAchat),
          remboursable: fiche.remboursable,
          tauxRemboursement: num(fiche.tauxRemboursement),
          prixBaseRemboursement: num(fiche.prixBaseRemboursement),
          necessitePrescription: fiche.necessitePrescription,
          refrigerationRequise: fiche.refrigerationRequise,
          posologieAdulte: fiche.posologieAdulte,
          posologieEnfant: fiche.posologieEnfant,
          monographie: fiche.monographie,
          actifCatalogue: fiche.actifCatalogue,
        }
      : null,
    local: stock
      ? {
          supplierNom: stock.supplier?.name ?? null,
          referenceInterne: stock.referenceInterne,
          localisation: stock.localisation,
          stockMinimum: stock.stockMinimum,
          prixAchat: num(stock.prixAchat),
          categorie: stock.categorie,
          indications: stock.indications,
          contreIndicationConduite: stock.contreIndicationConduite,
          contreIndicationAllaitement: stock.contreIndicationAllaitement,
          contreIndicationGrossesse: stock.contreIndicationGrossesse,
          conditionnement: stock.conditionnement,
        }
      : null,
    lots: stock?.lots ?? [],
    photos: fiche?.photos ?? [],
  };
}

export type RefreshResult =
  | { ok: true; champsModifies: number }
  | { ok: false; error: string };

/**
 * Réimporte les valeurs actuelles du catalogue dans la fiche de l'officine.
 *
 * **Uniquement sur demande explicite du pharmacien.** Rien n'appelle ceci
 * automatiquement, et c'est le point important : depuis le correctif de
 * conception, la copie appartient à la pharmacie. Une resynchronisation
 * silencieuse écraserait ses corrections — un prix qu'elle a ajusté, une
 * posologie qu'elle a précisée — sans que personne le remarque.
 *
 * Écrase donc bien ce qui vient du catalogue, et **seulement** cela : la
 * quantité, le seuil, le prix d'achat, l'emplacement, la référence interne
 * et le fournisseur ne sont jamais touchés. Ce sont des faits de l'officine,
 * pas des données produit.
 */
export async function refreshFromCatalogue(productId: string): Promise<RefreshResult> {
  const user = await requireUser();

  const product = await prisma.product.findFirst({
    where: { id: productId, pharmacyId: user.pharmacyId },
  });
  if (!product) return { ok: false, error: "Produit introuvable." };
  if (!product.catalogueProduitId) {
    return {
      ok: false,
      error: "Ce produit n'est rattaché à aucune fiche du catalogue.",
    };
  }

  const fiche = await prisma.catalogueProduit.findUnique({
    where: { id: product.catalogueProduitId },
    include: {
      photos: { select: { url: true }, orderBy: [{ ordre: "asc" }, { dateAjout: "asc" }], take: 1 },
    },
  });
  if (!fiche) {
    return { ok: false, error: "La fiche catalogue d'origine n'existe plus." };
  }

  const snapshot = catalogueSnapshot(fiche);

  // Ce que la fiche produit affiche vient de `products` ; la copie
  // `pharmacy_stock` doit suivre le même mouvement, sans quoi les deux
  // divergeraient à partir de ce clic.
  const productFields = {
    name: fiche.nom,
    form: fiche.formeGalenique,
    dosage: fiche.dosage,
    laboratory: fiche.laboratoire,
    barcode: fiche.codeBarres,
    dci: fiche.dci,
    photoUrl: fiche.photos[0]?.url ?? null,
    category: fiche.classeTherapeutique,
    price: fiche.ppv ?? product.price,
    pph: fiche.pph,
    tvaVente: fiche.tvaVente,
    tvaAchat: fiche.tvaAchat,
    remboursable: fiche.remboursable,
    baseRemboursement: fiche.prixBaseRemboursement,
    posologieAdulte: fiche.posologieAdulte,
    posologieEnfant: fiche.posologieEnfant,
    monographie: fiche.monographie,
  };

  // Compté avant écriture, pour dire au pharmacien ce que le clic a changé
  // plutôt que « c'est fait ».
  const champsModifies = Object.entries(productFields).filter(([key, value]) => {
    const current = product[key as keyof typeof product];
    if (current instanceof Date || value instanceof Date) return false;
    return String(current ?? "") !== String(value ?? "");
  }).length;

  try {
    await prisma.$transaction([
      prisma.product.update({ where: { id: product.id }, data: productFields }),
      prisma.pharmacyStock.updateMany({
        where: {
          pharmacyId: user.pharmacyId,
          catalogueProduitId: product.catalogueProduitId,
        },
        data: snapshot,
      }),
    ]);
  } catch (error) {
    // Le code-barres du catalogue peut déjà être porté par un autre produit
    // de cette officine, saisi à la main.
    if ((error as { code?: string } | null)?.code === "P2002") {
      return {
        ok: false,
        error:
          "Le code-barres du catalogue est déjà utilisé par un autre produit de votre stock.",
      };
    }
    throw error;
  }

  revalidatePath("/dashboard/stock");
  revalidatePath(`/dashboard/stock/produits/${product.id}`);
  return { ok: true, champsModifies };
}

/**
 * Pose une TVA manquante en un clic, depuis la fiche produit.
 *
 * Une écriture volontairement étroite : uniquement `tvaVente` ou
 * `tvaAchat`, uniquement sur un produit de cette officine. Rouvrir le
 * formulaire en quatre étapes pour un seul pourcentage est ce qui fait
 * qu'on ne le complète jamais.
 *
 * La valeur est celle que l'interface a proposée, mais elle est
 * revalidée ici : le champ ciblé comme le taux viennent du client.
 */
export async function setProductTva(
  productId: string,
  field: "tvaVente" | "tvaAchat",
  value: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();

  if (field !== "tvaVente" && field !== "tvaAchat") {
    return { ok: false, error: "Champ non modifiable." };
  }
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return { ok: false, error: "Taux invalide." };
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, pharmacyId: user.pharmacyId },
    select: { id: true, catalogueProduitId: true },
  });
  if (!product) return { ok: false, error: "Produit introuvable." };

  await prisma.product.update({ where: { id: product.id }, data: { [field]: value } });

  // La copie `pharmacy_stock` porte les mêmes colonnes : la laisser en
  // arrière ferait réapparaître le trou au prochain écran qui la lit.
  if (product.catalogueProduitId) {
    await prisma.pharmacyStock.updateMany({
      where: { pharmacyId: user.pharmacyId, catalogueProduitId: product.catalogueProduitId },
      data: { [field]: value },
    });
  }

  revalidatePath(`/dashboard/stock/produits/${product.id}`);
  return { ok: true };
}
