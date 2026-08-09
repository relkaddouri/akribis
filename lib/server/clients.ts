"use server";

/**
 * Read/write facade for clients — same seam as lib/offline/products.ts,
 * meant to be swapped for an IndexedDB-backed implementation later.
 *
 * Named `addClient` rather than `createClient` on purpose: that name is
 * already used by the Supabase client factories in lib/supabase/*, and
 * this file is often imported alongside session helpers that pull those
 * in transitively.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { clientFormSchema, type ClientFormInput } from "@/lib/validations/clients";
import type { ClientModel } from "@/lib/db/generated/models";

export type ListClientsParams = {
  /** Matches against name and phone (case-insensitive). */
  search?: string;
};

export async function listClients(params: ListClientsParams = {}): Promise<ClientModel[]> {
  const user = await requireUser();
  const search = params.search?.trim();

  return prisma.client.findMany({
    where: {
      pharmacyId: user.pharmacyId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { phone: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
  });
}

export type ClientPurchase = {
  saleId: string;
  createdAt: Date;
  totalAmount: number;
  paymentMethod: string;
  items: Array<{
    id: string;
    productName: string;
    quantity: number;
    unitPrice: number;
  }>;
};

export type ClientWithHistory = ClientModel & { purchases: ClientPurchase[] };

/** Purchase history comes from this client's sales, each with its line items. */
export async function getClient(id: string): Promise<ClientWithHistory | null> {
  const user = await requireUser();

  const client = await prisma.client.findFirst({
    where: { id, pharmacyId: user.pharmacyId },
    include: {
      sales: {
        orderBy: { createdAt: "desc" },
        include: {
          items: { include: { product: { select: { name: true } } } },
        },
      },
    },
  });
  if (!client) return null;

  const { sales, ...clientFields } = client;

  return {
    ...clientFields,
    purchases: sales.map((sale) => ({
      saleId: sale.id,
      createdAt: sale.createdAt,
      totalAmount: Number(sale.totalAmount),
      paymentMethod: sale.paymentMethod,
      items: sale.items.map((item) => ({
        id: item.id,
        productName: item.product.name,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
      })),
    })),
  };
}

export async function addClient(input: ClientFormInput): Promise<ClientModel> {
  const user = await requireUser();
  const data = clientFormSchema.parse(input);

  const client = await prisma.client.create({
    data: {
      pharmacyId: user.pharmacyId,
      name: data.name,
      phone: data.phone,
    },
  });

  revalidatePath("/dashboard/clients");
  return client;
}
