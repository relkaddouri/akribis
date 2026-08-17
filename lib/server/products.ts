"use server";

/**
 * Server-side, Prisma-backed sync target for products. The app doesn't
 * call this directly anymore — client components go through the
 * Dexie-backed offline layer at lib/offline/products.ts, whose sync
 * engine calls these functions in the background once the browser is
 * online. This file is the only thing that talks to Prisma for
 * products.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { productFormSchema, type ProductFormInput } from "@/lib/validations/products";
import type { ProductModel } from "@/lib/db/generated/models";

export type ListProductsParams = {
  /** Matches against name, barcode and DCI (case-insensitive). */
  search?: string;
};

type DecimalField =
  | "price"
  | "purchasePrice"
  | "pph"
  | "tvaVente"
  | "tvaAchat"
  | "baseRemboursement";

/**
 * Prisma's `Decimal` isn't a plain JSON value, so every Decimal column
 * is converted to a number (or null) at this facade boundary — every
 * caller (client components, TanStack Query) gets a plain serializable
 * product.
 */
export type ProductRecord = Omit<ProductModel, DecimalField> & {
  price: number;
  purchasePrice: number | null;
  pph: number | null;
  tvaVente: number | null;
  tvaAchat: number | null;
  baseRemboursement: number | null;
};

function toProductRecord(product: ProductModel): ProductRecord {
  return {
    ...product,
    price: Number(product.price),
    // Was missing from the conversion while nothing read it; a Decimal
    // reaching a client component throws at the RSC boundary.
    purchasePrice: product.purchasePrice !== null ? Number(product.purchasePrice) : null,
    pph: product.pph !== null ? Number(product.pph) : null,
    tvaVente: product.tvaVente !== null ? Number(product.tvaVente) : null,
    tvaAchat: product.tvaAchat !== null ? Number(product.tvaAchat) : null,
    baseRemboursement: product.baseRemboursement !== null ? Number(product.baseRemboursement) : null,
  };
}

export async function listProducts(params: ListProductsParams = {}): Promise<ProductRecord[]> {
  const user = await requireUser();
  const search = params.search?.trim();

  const products = await prisma.product.findMany({
    where: {
      pharmacyId: user.pharmacyId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { barcode: { contains: search, mode: "insensitive" } },
              { dci: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
  });

  return products.map(toProductRecord);
}

export async function getProduct(id: string): Promise<ProductRecord | null> {
  const user = await requireUser();
  const product = await prisma.product.findFirst({
    where: { id, pharmacyId: user.pharmacyId },
  });
  return product ? toProductRecord(product) : null;
}

function dataFromInput(data: ReturnType<typeof productFormSchema.parse>) {
  return {
    name: data.name,
    form: data.form,
    dosage: data.dosage,
    laboratory: data.laboratory,
    barcode: data.barcode,
    dci: data.dci,
    photoUrl: data.photoUrl,
    category: data.category,
    price: data.price,
    pph: data.pph ?? null,
    tvaVente: data.tvaVente ?? null,
    tvaAchat: data.tvaAchat ?? null,
    lowStockThreshold: data.lowStockThreshold,
    quantityInStock: data.quantityInStock,
    nearestExpiryDate: data.nearestExpiryDate ? new Date(data.nearestExpiryDate) : null,
    remboursable: data.remboursable,
    baseRemboursement: data.remboursable ? (data.baseRemboursement ?? null) : null,
    posologieEnfant: data.posologieEnfant,
    posologieAdulte: data.posologieAdulte,
    monographie: data.monographie,
  };
}

export async function createProduct(
  input: ProductFormInput,
  options?: { id?: string },
): Promise<ProductRecord> {
  const user = await requireUser();
  const data = productFormSchema.parse(input);

  const product = await prisma.product.create({
    data: {
      // Lets the offline layer pass the id it already generated for the
      // optimistic local record, so the synced row keeps the same id
      // instead of needing a temp-id -> real-id reconciliation step.
      ...(options?.id ? { id: options.id } : {}),
      pharmacyId: user.pharmacyId,
      ...dataFromInput(data),
    },
  });

  revalidatePath("/dashboard/stock");
  return toProductRecord(product);
}

export async function updateProduct(
  id: string,
  input: ProductFormInput,
): Promise<ProductRecord> {
  const user = await requireUser();
  const data = productFormSchema.parse(input);

  // Prisma's unique `where` can't combine id + pharmacyId (no such
  // compound key), so tenant ownership is checked explicitly before the
  // by-id update — otherwise a guessed id from another pharmacy could be
  // edited.
  const existing = await prisma.product.findFirst({
    where: { id, pharmacyId: user.pharmacyId },
    select: { id: true },
  });
  if (!existing) {
    throw new Error("Produit introuvable");
  }

  const product = await prisma.product.update({
    where: { id },
    data: dataFromInput(data),
  });

  revalidatePath("/dashboard/stock");
  return toProductRecord(product);
}
