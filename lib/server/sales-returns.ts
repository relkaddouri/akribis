"use server";

/**
 * Sales history and returns. Every read and write is scoped to the
 * caller's own pharmacy via requireUser(), so a sale id from another
 * tenant never resolves here.
 *
 * The POS (lib/offline/sales.ts) stays purely about taking money in;
 * this module owns everything that happens to a sale afterwards.
 */

import { revalidatePath } from "next/cache";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import {
  computeReturnStatus,
  formatSaleReference,
  saleReferenceToIdFragment,
  validateReturn,
  type ReturnLineInput,
  type SaleReturnStatusValue,
} from "@/lib/sales/returns";

type PaymentMethodValue = "CASH" | "CARD" | "CREDIT";

export type SaleListItem = {
  id: string;
  reference: string;
  createdAt: Date;
  clientName: string | null;
  totalAmount: number;
  paymentMethod: PaymentMethodValue;
  returnStatus: SaleReturnStatusValue;
  invoiced: boolean;
};

export type SaleDetail = SaleListItem & {
  clientPhone: string | null;
  invoiceNumber: string | null;
  lines: Array<{
    saleItemId: string;
    productId: string;
    productName: string;
    quantity: number;
    returnedQuantity: number;
    unitPrice: number;
    lineTotal: number;
    /** Product-level reimbursement info, shown on the detail screen. */
    remboursable: boolean;
    baseRemboursement: number | null;
  }>;
  returns: Array<{
    id: string;
    createdAt: Date;
    totalRefund: number;
    isLotRecall: boolean;
    recallReference: string | null;
    note: string | null;
    lines: Array<{
      productName: string;
      quantity: number;
      refundAmount: number;
      restocked: boolean;
    }>;
  }>;
};

function toStatus(value: string): SaleReturnStatusValue {
  return value.toLowerCase() as SaleReturnStatusValue;
}

export type SalesFilters = {
  search?: string;
  from?: string;
  to?: string;
  status?: SaleReturnStatusValue | "all";
  paymentMethod?: PaymentMethodValue | "all";
};

export async function listSales(filters?: SalesFilters): Promise<SaleListItem[]> {
  const user = await requireUser();

  const search = filters?.search?.trim();
  const from = filters?.from ? new Date(filters.from) : undefined;
  // `to` is an inclusive calendar day in the UI, so the bound is pushed to
  // the end of that day — midnight would silently drop the whole day.
  const to = filters?.to ? new Date(`${filters.to}T23:59:59.999`) : undefined;

  const sales = await prisma.sale.findMany({
    where: {
      pharmacyId: user.pharmacyId,
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
      ...(filters?.status && filters.status !== "all"
        ? { returnStatus: filters.status.toUpperCase() as "NONE" | "PARTIAL" | "FULL" }
        : {}),
      ...(filters?.paymentMethod && filters.paymentMethod !== "all"
        ? { paymentMethod: filters.paymentMethod }
        : {}),
      ...(search
        ? {
            OR: [
              { client: { name: { contains: search, mode: "insensitive" } } },
              // Matches whether the operator pasted "VTE-1A2B3C4D" or just
              // the fragment; the uuid keeps its dashes, so compare on the
              // undashed prefix the reference is built from.
              { id: { startsWith: saleReferenceToIdFragment(search) } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      totalAmount: true,
      paymentMethod: true,
      returnStatus: true,
      invoiceId: true,
      client: { select: { name: true } },
    },
  });

  return sales.map((sale) => ({
    id: sale.id,
    reference: formatSaleReference(sale.id),
    createdAt: sale.createdAt,
    clientName: sale.client?.name ?? null,
    totalAmount: Number(sale.totalAmount),
    paymentMethod: sale.paymentMethod as PaymentMethodValue,
    returnStatus: toStatus(sale.returnStatus),
    invoiced: sale.invoiceId !== null,
  }));
}

export type ClientSaleListItem = SaleListItem & { summary: string };

/** Sales of one client, with a short product summary for the history table. */
export async function listClientSales(clientId: string): Promise<ClientSaleListItem[]> {
  const user = await requireUser();

  const sales = await prisma.sale.findMany({
    where: { pharmacyId: user.pharmacyId, clientId },
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { name: true } },
      items: { include: { product: { select: { name: true } } } },
    },
  });

  return sales.map((sale) => {
    const names = sale.items.map((item) => item.product.name);
    // Two names then a count: enough to recognise the sale without
    // stretching the column on a long basket.
    const summary =
      names.length <= 2
        ? names.join(", ")
        : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;

    return {
      id: sale.id,
      reference: formatSaleReference(sale.id),
      createdAt: sale.createdAt,
      clientName: sale.client?.name ?? null,
      totalAmount: Number(sale.totalAmount),
      paymentMethod: sale.paymentMethod as PaymentMethodValue,
      returnStatus: toStatus(sale.returnStatus),
      invoiced: sale.invoiceId !== null,
      summary,
    };
  });
}

export async function getSale(id: string): Promise<SaleDetail | null> {
  const user = await requireUser();

  const sale = await prisma.sale.findFirst({
    where: { id, pharmacyId: user.pharmacyId },
    include: {
      client: { select: { name: true, phone: true } },
      invoice: { select: { number: true } },
      items: {
        include: {
          product: {
            select: { name: true, remboursable: true, baseRemboursement: true },
          },
        },
      },
      returns: {
        orderBy: { createdAt: "desc" },
        include: { lines: { include: { product: { select: { name: true } } } } },
      },
    },
  });
  if (!sale) return null;

  return {
    id: sale.id,
    reference: formatSaleReference(sale.id),
    createdAt: sale.createdAt,
    clientName: sale.client?.name ?? null,
    clientPhone: sale.client?.phone ?? null,
    totalAmount: Number(sale.totalAmount),
    paymentMethod: sale.paymentMethod as PaymentMethodValue,
    returnStatus: toStatus(sale.returnStatus),
    invoiced: sale.invoiceId !== null,
    invoiceNumber: sale.invoice?.number ?? null,
    lines: sale.items.map((item) => ({
      saleItemId: item.id,
      productId: item.productId,
      productName: item.product.name,
      quantity: item.quantity,
      returnedQuantity: item.returnedQuantity,
      unitPrice: Number(item.unitPrice),
      lineTotal: Number(item.unitPrice) * item.quantity,
      remboursable: item.product.remboursable,
      baseRemboursement:
        item.product.baseRemboursement === null ? null : Number(item.product.baseRemboursement),
    })),
    returns: sale.returns.map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt,
      totalRefund: Number(entry.totalRefund),
      isLotRecall: entry.isLotRecall,
      recallReference: entry.recallReference,
      note: entry.note,
      lines: entry.lines.map((line) => ({
        productName: line.product.name,
        quantity: line.quantity,
        refundAmount: Number(line.refundAmount),
        restocked: line.restocked,
      })),
    })),
  };
}

export type CreateSaleReturnInput = {
  lines: ReturnLineInput[];
  isLotRecall: boolean;
  recallReference?: string;
  note?: string;
};

export type CreateSaleReturnResult = { returnId: string; totalRefund: number };

/**
 * Records a return against a sale: refunds the chosen lines, credits stock
 * for the ones kept, and leaves a trace for the ones destroyed.
 *
 * Restocking is decided per line, per return — a recalled batch must not
 * go back on the shelf, while an ordinary client return usually should.
 * That's why `restock` is an input rather than a pharmacy-wide setting.
 */
export async function createSaleReturn(
  saleId: string,
  input: CreateSaleReturnInput,
): Promise<CreateSaleReturnResult> {
  const user = await requireUser();

  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id: saleId, pharmacyId: user.pharmacyId },
      include: { items: { include: { product: { select: { name: true } } } } },
    });
    if (!sale) throw new Error("Vente introuvable.");

    const validation = validateReturn(
      sale.items.map((item) => ({
        saleItemId: item.id,
        productId: item.productId,
        productName: item.product.name,
        quantity: item.quantity,
        returnedQuantity: item.returnedQuantity,
        unitPrice: Number(item.unitPrice),
      })),
      input.lines,
    );
    if (!validation.ok) throw new Error(validation.error.message);

    const saleReturn = await tx.saleReturn.create({
      data: {
        pharmacyId: user.pharmacyId,
        saleId: sale.id,
        userId: user.id,
        isLotRecall: input.isLotRecall,
        recallReference: input.recallReference?.trim() || null,
        note: input.note?.trim() || null,
        totalRefund: new Prisma.Decimal(validation.totalRefund),
        lines: {
          create: validation.lines.map((line) => ({
            saleItemId: line.saleItemId,
            productId: line.productId,
            quantity: line.quantity,
            unitPrice: new Prisma.Decimal(line.unitPrice),
            refundAmount: new Prisma.Decimal(line.refundAmount),
            restocked: line.restock,
          })),
        },
      },
      select: { id: true },
    });

    for (const line of validation.lines) {
      const soldQuantity = sale.items.find((item) => item.id === line.saleItemId)!.quantity;

      // Atomic conditional increment, same guard as createSale's stock
      // decrement: the `lte` bound is evaluated inside the UPDATE, so two
      // returns submitted at once can't both pass validation and push the
      // cumulative quantity past what was sold.
      const updated = await tx.saleItem.updateMany({
        where: {
          id: line.saleItemId,
          pharmacyId: user.pharmacyId,
          returnedQuantity: { lte: soldQuantity - line.quantity },
        },
        data: { returnedQuantity: { increment: line.quantity } },
      });
      if (updated.count === 0) {
        throw new Error(
          `Quantité déjà retournée entre-temps pour « ${line.productName} » — rechargez la vente.`,
        );
      }

      if (!line.restock) continue;

      await tx.product.update({
        where: { id: line.productId },
        data: { quantityInStock: { increment: line.quantity } },
      });
      await tx.stockMovement.create({
        data: {
          pharmacyId: user.pharmacyId,
          productId: line.productId,
          type: "IN",
          quantity: line.quantity,
          reason: input.isLotRecall
            ? `Retour vente ${formatSaleReference(sale.id)} — rappel de lot${
                input.recallReference ? ` (${input.recallReference.trim()})` : ""
              }`
            : `Retour vente ${formatSaleReference(sale.id)}`,
        },
      });
    }

    // Recompute from the post-update quantities rather than from the
    // pre-read snapshot, so the stored status matches the rows.
    const refreshed = await tx.saleItem.findMany({
      where: { saleId: sale.id },
      select: { quantity: true, returnedQuantity: true },
    });
    const status = computeReturnStatus(refreshed);

    await tx.sale.update({
      where: { id: sale.id },
      data: { returnStatus: status.toUpperCase() as "NONE" | "PARTIAL" | "FULL" },
    });

    revalidatePath("/ventes");
    revalidatePath(`/ventes/${sale.id}`);

    return { returnId: saleReturn.id, totalRefund: validation.totalRefund };
  });
}
