"use server";

/**
 * Supplier credit notes — one document that moves from `emis` to `recu`.
 * Every read and write is scoped to the caller's own pharmacy via
 * requireUser().
 *
 * STOCK RULE, enforced here and nowhere else: the goods are taken off the
 * shelf when the credit is ISSUED. `settleSupplierCredit` deliberately
 * touches no stock at all — it only records how the supplier compensated.
 * That asymmetry is the whole point: a decrement in both places would
 * remove the same units twice.
 */

import { revalidatePath } from "next/cache";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { allocateDocumentNumber } from "@/lib/server/sequences";
import {
  affectsStock,
  canTransition,
  computeCreditTotal,
  type CompensationModeValue,
  type CreditLineInput,
  type SupplierCreditMotifValue,
  type SupplierCreditStatusValue,
} from "@/lib/suppliers/credits";

function toDbMotif(value: SupplierCreditMotifValue) {
  return value.toUpperCase() as
    | "PRODUIT_ENDOMMAGE"
    | "PRODUIT_PERIME"
    | "RAPPEL_LOT"
    | "ERREUR_LIVRAISON"
    | "ERREUR_PRIX"
    | "REMISE"
    | "AUTRE";
}

function toUiStatus(value: string): SupplierCreditStatusValue {
  return value.toLowerCase() as SupplierCreditStatusValue;
}

export type SupplierCreditListItem = {
  id: string;
  numero: number;
  supplierId: string;
  supplierName: string;
  orderId: string | null;
  orderNumero: number | null;
  statut: SupplierCreditStatusValue;
  motif: SupplierCreditMotifValue;
  montant: number;
  dateEmission: Date;
  dateReception: Date | null;
  lieRappelLot: boolean;
  modeCompensation: CompensationModeValue | null;
};

export type SupplierCreditDetail = SupplierCreditListItem & {
  note: string | null;
  lines: Array<{
    id: string;
    productName: string;
    quantite: number;
    unitPrice: number;
    total: number;
  }>;
};

/** A product that actually arrived for an order — the pool a claim draws from. */
export type CreditableProduct = {
  productId: string;
  productName: string;
  /** Cumulative quantity delivered across every reception of the order. */
  quantiteLivree: number;
  /** Price paid to the supplier on that order line. */
  unitPrice: number;
};

export type CreateSupplierCreditInput = {
  supplierId: string;
  orderId?: string | null;
  motif: SupplierCreditMotifValue;
  lieRappelLot?: boolean;
  note?: string;
  lines: CreditLineInput[];
};

/**
 * Issues a credit note. This is the single point where stock moves for a
 * credit: the goods are going back to the supplier now, whether or not the
 * supplier has agreed to compensate yet.
 */
export async function createSupplierCredit(
  input: CreateSupplierCreditInput,
): Promise<{ id: string; numero: number }> {
  const user = await requireUser();

  const lines = input.lines.filter((line) => line.quantite > 0);
  if (lines.length === 0) {
    throw new Error("Ajoutez au moins un produit à l'avoir.");
  }

  const credit = await prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({
      where: { id: input.supplierId, pharmacyId: user.pharmacyId },
      select: { id: true },
    });
    if (!supplier) throw new Error("Fournisseur introuvable.");

    if (input.orderId) {
      const order = await tx.order.findFirst({
        where: { id: input.orderId, pharmacyId: user.pharmacyId },
        select: { id: true },
      });
      if (!order) throw new Error("Commande introuvable.");
    }

    const productIds = [...new Set(lines.map((line) => line.productId))];
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, pharmacyId: user.pharmacyId },
      select: { id: true, name: true, quantityInStock: true },
    });
    if (products.length !== productIds.length) {
      throw new Error("Un ou plusieurs produits sont introuvables.");
    }

    const numero = await allocateDocumentNumber(tx, user.pharmacyId, "supplier_credit");

    const created = await tx.supplierCredit.create({
      data: {
        pharmacyId: user.pharmacyId,
        supplierId: supplier.id,
        orderId: input.orderId ?? null,
        numero,
        statut: "EMIS",
        motif: toDbMotif(input.motif),
        montant: new Prisma.Decimal(computeCreditTotal(lines)),
        montantRestant: new Prisma.Decimal(computeCreditTotal(lines)),
        lieRappelLot: input.lieRappelLot ?? false,
        note: input.note?.trim() || null,
        items: {
          create: lines.map((line) => ({
            productId: line.productId,
            quantite: line.quantite,
            unitPrice: new Prisma.Decimal(line.unitPrice),
          })),
        },
      },
      select: { id: true, numero: true },
    });

    // A price-only claim moves money, not merchandise.
    if (affectsStock(input.motif)) {
      const byId = new Map(products.map((product) => [product.id, product]));

      for (const line of lines) {
        const product = byId.get(line.productId)!;

        // Atomic conditional decrement, same guard as createSale: the
        // `gte` check happens inside the UPDATE, so two credits issued at
        // once can't both pass a separate stock read and drive the shelf
        // below zero.
        const decremented = await tx.product.updateMany({
          where: {
            id: line.productId,
            pharmacyId: user.pharmacyId,
            quantityInStock: { gte: line.quantite },
          },
          data: { quantityInStock: { decrement: line.quantite } },
        });
        if (decremented.count === 0) {
          throw new Error(
            `Stock insuffisant pour "${product.name}" (${product.quantityInStock} disponible(s)).`,
          );
        }

        await tx.stockMovement.create({
          data: {
            pharmacyId: user.pharmacyId,
            productId: line.productId,
            type: "OUT",
            quantity: line.quantite,
            reason: `Avoir fournisseur ${numero}${input.lieRappelLot ? " — rappel de lot" : ""}`,
          },
        });
      }
    }

    return created;
  });

  revalidatePath("/commandes");
  revalidatePath("/dashboard/stock");
  return credit;
}

/**
 * Records that the supplier honoured the credit, and how.
 *
 * NO STOCK MOVEMENT HERE — deliberately. The goods left when the credit was
 * issued; this only closes the paperwork. The transition guard also refuses
 * to settle an already-settled credit, so even a double submit can't
 * re-run this.
 */
export async function settleSupplierCredit(
  id: string,
  modeCompensation: CompensationModeValue,
): Promise<void> {
  const user = await requireUser();

  await prisma.$transaction(async (tx) => {
    const credit = await tx.supplierCredit.findFirst({
      where: { id, pharmacyId: user.pharmacyId },
      select: { id: true, statut: true },
    });
    if (!credit) throw new Error("Avoir introuvable.");

    if (!canTransition(toUiStatus(credit.statut), "recu")) {
      throw new Error("Cet avoir a déjà été réceptionné.");
    }

    await tx.supplierCredit.update({
      where: { id: credit.id },
      data: {
        statut: "RECU",
        dateReception: new Date(),
        modeCompensation: modeCompensation.toUpperCase() as "AVOIR_CREDIT" | "ESPECES",
      },
    });
  });

  revalidatePath("/commandes");
  revalidatePath("/commandes/avoirs");
}

/**
 * Products the pharmacy has actually received for an order, with the price
 * it paid. A claim can only ever concern goods that arrived — offering the
 * full order would let someone raise a credit for a shipment still in
 * transit.
 */
export async function listCreditableProductsForOrder(
  orderId: string,
): Promise<CreditableProduct[]> {
  const user = await requireUser();

  const order = await prisma.order.findFirst({
    where: { id: orderId, pharmacyId: user.pharmacyId },
    include: {
      items: { include: { product: { select: { id: true, name: true } } } },
      deliveries: { include: { items: true } },
    },
  });
  if (!order) return [];

  // Delivered quantities live on the delivery lines; sum them per order line.
  const deliveredByItem = new Map<string, number>();
  for (const delivery of order.deliveries) {
    for (const line of delivery.items) {
      deliveredByItem.set(
        line.orderItemId,
        (deliveredByItem.get(line.orderItemId) ?? 0) + line.quantiteRecue,
      );
    }
  }

  return order.items
    .map((item) => ({
      productId: item.product.id,
      productName: item.product.name,
      quantiteLivree: deliveredByItem.get(item.id) ?? 0,
      unitPrice: Number(item.unitPrice),
    }))
    .filter((entry) => entry.quantiteLivree > 0);
}

export async function getSupplierCredit(id: string): Promise<SupplierCreditDetail | null> {
  const user = await requireUser();

  const credit = await prisma.supplierCredit.findFirst({
    where: { id, pharmacyId: user.pharmacyId },
    include: {
      supplier: { select: { name: true } },
      order: { select: { numero: true } },
      items: { include: { product: { select: { name: true } } } },
    },
  });
  if (!credit) return null;

  return {
    id: credit.id,
    numero: credit.numero,
    supplierId: credit.supplierId,
    supplierName: credit.supplier.name,
    orderId: credit.orderId,
    orderNumero: credit.order?.numero ?? null,
    statut: toUiStatus(credit.statut),
    motif: credit.motif.toLowerCase() as SupplierCreditMotifValue,
    montant: Number(credit.montant),
    dateEmission: credit.dateEmission,
    dateReception: credit.dateReception,
    lieRappelLot: credit.lieRappelLot,
    modeCompensation: credit.modeCompensation
      ? (credit.modeCompensation.toLowerCase() as CompensationModeValue)
      : null,
    note: credit.note,
    lines: credit.items.map((item) => ({
      id: item.id,
      productName: item.product.name,
      quantite: item.quantite,
      unitPrice: Number(item.unitPrice),
      total: Math.round(Number(item.unitPrice) * item.quantite * 100) / 100,
    })),
  };
}

export type UsableSupplierCredit = {
  id: string;
  numero: number;
  motif: SupplierCreditMotifValue;
  montant: number;
  montantRestant: number;
  dateReception: Date | null;
};

/**
 * Credits that may actually be applied to a new order for this supplier.
 *
 * Three conditions, all required: CONFIRMED by the supplier (an `emis`
 * claim is a request, not a guaranteed credit — offering it would promise
 * money nobody has agreed to), settled as a credit note rather than cash
 * (cash already came back), and not yet fully consumed.
 */
export async function listUsableSupplierCredits(
  supplierId: string,
): Promise<UsableSupplierCredit[]> {
  const user = await requireUser();

  const credits = await prisma.supplierCredit.findMany({
    where: {
      pharmacyId: user.pharmacyId,
      supplierId,
      statut: "RECU",
      modeCompensation: "AVOIR_CREDIT",
      montantRestant: { gt: 0 },
    },
    orderBy: { dateEmission: "asc" },
    select: {
      id: true,
      numero: true,
      motif: true,
      montant: true,
      montantRestant: true,
      dateReception: true,
    },
  });

  return credits.map((credit) => ({
    id: credit.id,
    numero: credit.numero,
    motif: credit.motif.toLowerCase() as SupplierCreditMotifValue,
    montant: Number(credit.montant),
    montantRestant: Number(credit.montantRestant),
    dateReception: credit.dateReception,
  }));
}

/**
 * Credit still available with a supplier: settled claims they chose to
 * compensate as a credit note rather than cash.
 *
 * Cash settlements are excluded — that money already came back, so counting
 * it here would promise a discount twice. Claims still awaiting confirmation
 * are excluded too: nothing is owed until the supplier agrees.
 */
export async function getSupplierCreditBalance(supplierId: string): Promise<number> {
  const user = await requireUser();

  const result = await prisma.supplierCredit.aggregate({
    where: {
      pharmacyId: user.pharmacyId,
      supplierId,
      statut: "RECU",
      modeCompensation: "AVOIR_CREDIT",
    },
    // What's left, not the face value: a credit already spent on an earlier
    // order must not still read as available.
    _sum: { montantRestant: true },
  });

  return Number(result._sum.montantRestant ?? 0);
}

export async function listSupplierCredits(): Promise<SupplierCreditListItem[]> {
  const user = await requireUser();

  const credits = await prisma.supplierCredit.findMany({
    where: { pharmacyId: user.pharmacyId },
    orderBy: { dateEmission: "desc" },
    include: {
      supplier: { select: { name: true } },
      order: { select: { numero: true } },
    },
  });

  return credits.map((credit) => ({
    id: credit.id,
    numero: credit.numero,
    supplierId: credit.supplierId,
    supplierName: credit.supplier.name,
    orderId: credit.orderId,
    orderNumero: credit.order?.numero ?? null,
    statut: toUiStatus(credit.statut),
    motif: credit.motif.toLowerCase() as SupplierCreditMotifValue,
    montant: Number(credit.montant),
    dateEmission: credit.dateEmission,
    dateReception: credit.dateReception,
    lieRappelLot: credit.lieRappelLot,
    modeCompensation: credit.modeCompensation
      ? (credit.modeCompensation.toLowerCase() as CompensationModeValue)
      : null,
  }));
}
