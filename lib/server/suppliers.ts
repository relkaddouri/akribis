"use server";

/**
 * Read/write facade for suppliers — same seam as lib/offline/products.ts.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { supplierFormSchema, type SupplierFormInput } from "@/lib/validations/orders";
import { getSupplierCreditBalance } from "@/lib/server/supplier-credits";
import {
  summariseSupplierActivity,
  type SupplierActivitySummary,
} from "@/lib/suppliers/activity";
import type {
  CompensationModeValue,
  SupplierCreditMotifValue,
  SupplierCreditStatusValue,
} from "@/lib/suppliers/credits";
import type { SupplierModel } from "@/lib/db/generated/models";
import type { OrderStatus } from "@/lib/db/generated/enums";

export async function listSuppliers(): Promise<SupplierModel[]> {
  const user = await requireUser();
  return prisma.supplier.findMany({
    where: { pharmacyId: user.pharmacyId },
    orderBy: { name: "asc" },
  });
}

export async function addSupplier(input: SupplierFormInput): Promise<SupplierModel> {
  const user = await requireUser();
  const data = supplierFormSchema.parse(input);

  const supplier = await prisma.supplier.create({
    data: {
      pharmacyId: user.pharmacyId,
      name: data.name,
      phone: data.phone,
      email: data.email,
    },
  });

  revalidatePath("/commandes/fournisseurs");
  return supplier;
}

export type SupplierOrderRow = {
  id: string;
  numero: number;
  createdAt: Date;
  status: OrderStatus;
  totalAmount: number;
};

export type SupplierDeliveryRow = {
  id: string;
  numero: number;
  dateReception: Date;
  orderId: string;
  orderNumero: number;
  /** Distinct products in the shipment, and the total units across them. */
  productCount: number;
  unitCount: number;
};

export type SupplierCreditRow = {
  id: string;
  numero: number;
  statut: SupplierCreditStatusValue;
  motif: SupplierCreditMotifValue;
  montant: number;
  /** Only meaningful for a confirmed credit note — see `modeCompensation`. */
  montantRestant: number;
  modeCompensation: CompensationModeValue | null;
  dateEmission: Date;
  dateReception: Date | null;
  lieRappelLot: boolean;
};

export type SupplierDetail = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  createdAt: Date;
  /** Same figure the new-order screen offers — see `getSupplierCreditBalance`. */
  creditBalance: number;
  stats: SupplierActivitySummary;
  orders: SupplierOrderRow[];
  deliveries: SupplierDeliveryRow[];
  credits: SupplierCreditRow[];
};

/**
 * Everything the supplier sheet shows, in one round trip.
 *
 * The credit balance is not recomputed here: it delegates to
 * `getSupplierCreditBalance`, the same function the new-order screen uses.
 * Two independent sums of the same credits would eventually disagree, and
 * the number a pharmacist reads on this page is the one they expect to see
 * deducted when they order.
 */
export async function getSupplierDetail(id: string): Promise<SupplierDetail | null> {
  const user = await requireUser();

  const supplier = await prisma.supplier.findFirst({
    where: { id, pharmacyId: user.pharmacyId },
    include: {
      orders: {
        orderBy: { createdAt: "desc" },
        include: { items: { select: { quantity: true, unitPrice: true } } },
      },
      credits: { orderBy: { dateEmission: "desc" } },
    },
  });
  if (!supplier) return null;

  // Deliveries hang off orders, not off the supplier, so they need their
  // own query rather than a nested include on an already-wide result.
  const deliveries = await prisma.delivery.findMany({
    where: { pharmacyId: user.pharmacyId, order: { supplierId: id } },
    orderBy: { dateReception: "desc" },
    include: {
      order: { select: { id: true, numero: true } },
      items: { select: { quantiteRecue: true } },
    },
  });

  const orders: SupplierOrderRow[] = supplier.orders.map((order) => ({
    id: order.id,
    numero: order.numero,
    createdAt: order.createdAt,
    status: order.status,
    totalAmount:
      Math.round(
        order.items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0) * 100,
      ) / 100,
  }));

  const credits: SupplierCreditRow[] = supplier.credits.map((credit) => ({
    id: credit.id,
    numero: credit.numero,
    statut: credit.statut.toLowerCase() as SupplierCreditStatusValue,
    motif: credit.motif.toLowerCase() as SupplierCreditMotifValue,
    montant: Number(credit.montant),
    montantRestant: Number(credit.montantRestant),
    modeCompensation: credit.modeCompensation
      ? (credit.modeCompensation.toLowerCase() as CompensationModeValue)
      : null,
    dateEmission: credit.dateEmission,
    dateReception: credit.dateReception,
    lieRappelLot: credit.lieRappelLot,
  }));

  return {
    id: supplier.id,
    name: supplier.name,
    phone: supplier.phone,
    email: supplier.email,
    createdAt: supplier.createdAt,
    creditBalance: await getSupplierCreditBalance(id),
    stats: summariseSupplierActivity(orders, credits),
    orders,
    deliveries: deliveries.map((delivery) => ({
      id: delivery.id,
      numero: delivery.numero,
      dateReception: delivery.dateReception,
      orderId: delivery.order.id,
      orderNumero: delivery.order.numero,
      productCount: delivery.items.length,
      unitCount: delivery.items.reduce((sum, item) => sum + item.quantiteRecue, 0),
    })),
    credits,
  };
}
