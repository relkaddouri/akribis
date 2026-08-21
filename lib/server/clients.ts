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

type DecimalField = "solde";

/**
 * Prisma `Decimal` n'est pas une valeur JSON — `solde` est aplati en nombre
 * à cette frontière, comme dans les autres façades.
 *
 * Sans cette conversion, la valeur ne lève pas : elle arrive dans le
 * navigateur en **chaîne de caractères**, silencieusement. `solde * 2`
 * fonctionne alors par coercition, mais `solde + paiement` concatène
 * ("0.00" + 100 = "0.00100"), `solde.toFixed(2)` échoue, et un tri se fait
 * dans l'ordre alphabétique. Sur un solde client, ce sont des dirhams.
 */
export type ClientRecord = Omit<ClientModel, DecimalField> & { solde: number };

function toClientRecord(client: ClientModel): ClientRecord {
  return { ...client, solde: Number(client.solde) };
}

export type ListClientsParams = {
  /** Matches against name and phone (case-insensitive). */
  search?: string;
};

export async function listClients(params: ListClientsParams = {}): Promise<ClientRecord[]> {
  const user = await requireUser();
  const search = params.search?.trim();

  const clients = await prisma.client.findMany({
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

  return clients.map(toClientRecord);
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

export type ClientWithHistory = ClientRecord & { purchases: ClientPurchase[] };

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
    ...toClientRecord(clientFields),
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

export async function addClient(input: ClientFormInput): Promise<ClientRecord> {
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
  return toClientRecord(client);
}
