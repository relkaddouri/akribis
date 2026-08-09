"use server";

/**
 * Invoicing facade. Every read and write is scoped to the caller's own
 * pharmacy via requireUser() — an invoice id from another tenant must
 * never resolve here.
 *
 * Available to owners and assistants alike: issuing an invoice is a
 * counter operation, not an administrative one.
 */

import { revalidatePath } from "next/cache";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { formatInvoiceNumber } from "@/lib/invoices/numbering";
import { computeInvoiceTotals, type InvoiceLineInput } from "@/lib/invoices/totals";

export type InvoiceListItem = {
  id: string;
  number: string;
  issuedAt: Date;
  clientName: string | null;
  totalTtc: number;
  status: "issued" | "cancelled";
};

export type InvoiceDetail = InvoiceListItem & {
  pharmacyName: string;
  pharmacyAddress: string | null;
  pharmacyPhone: string | null;
  pharmacyIce: string | null;
  totalHt: number;
  totalTva: number;
  lines: Array<{
    id: string;
    designation: string;
    quantity: number;
    unitPriceHt: number;
    tvaRate: number;
    totalHt: number;
    totalTva: number;
    totalTtc: number;
  }>;
  saleIds: string[];
};

/** A sale that hasn't been billed yet — the pool to build an invoice from. */
export type InvoiceableSale = {
  id: string;
  createdAt: Date;
  clientId: string | null;
  clientName: string | null;
  totalAmount: number;
  itemCount: number;
};

/**
 * Allocates the next sequence for (pharmacy, year) in ONE statement.
 *
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` is executed atomically
 * by Postgres and takes a row lock, so concurrent callers queue and each
 * gets a distinct value. Reading the current max and writing max+1 from
 * application code would interleave and hand two invoices the same
 * number — the unique indexes on Invoice would then reject one of them,
 * turning a race into a user-visible error.
 *
 * The counter only ever moves forward: cancelling an invoice leaves its
 * number burned, which is exactly what sequential numbering requires.
 */
async function allocateSequence(
  tx: Prisma.TransactionClient,
  pharmacyId: string,
  year: number,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ last_sequence: number }>>`
    INSERT INTO invoice_counters (pharmacy_id, year, last_sequence)
    VALUES (${pharmacyId}, ${year}, 1)
    ON CONFLICT (pharmacy_id, year)
    DO UPDATE SET last_sequence = invoice_counters.last_sequence + 1
    RETURNING last_sequence
  `;

  const sequence = rows[0]?.last_sequence;
  if (typeof sequence !== "number") {
    throw new Error("Impossible d'attribuer un numéro de facture.");
  }
  return sequence;
}

/** Sales not yet attached to an invoice, newest first. */
export async function listInvoiceableSales(): Promise<InvoiceableSale[]> {
  const user = await requireUser();

  const sales = await prisma.sale.findMany({
    where: { pharmacyId: user.pharmacyId, invoiceId: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      clientId: true,
      totalAmount: true,
      client: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });

  return sales.map((sale) => ({
    id: sale.id,
    createdAt: sale.createdAt,
    clientId: sale.clientId,
    clientName: sale.client?.name ?? null,
    totalAmount: Number(sale.totalAmount),
    itemCount: sale._count.items,
  }));
}

export type CreateInvoiceResult = { id: string; number: string };

/**
 * Issues one invoice covering `saleIds` (one sale, or several grouped).
 * The same format serves individuals, insurers and companies — there is
 * deliberately no client-type branching.
 */
export async function createInvoiceFromSales(saleIds: string[]): Promise<CreateInvoiceResult> {
  const user = await requireUser();
  const uniqueSaleIds = [...new Set(saleIds)];
  if (uniqueSaleIds.length === 0) {
    throw new Error("Sélectionnez au moins une vente à facturer.");
  }

  return prisma.$transaction(async (tx) => {
    // Tenant-scoped and unbilled-only: a sale id from another pharmacy,
    // or one already invoiced, simply won't be found.
    const sales = await tx.sale.findMany({
      where: { id: { in: uniqueSaleIds }, pharmacyId: user.pharmacyId, invoiceId: null },
      include: {
        client: { select: { id: true, name: true } },
        items: {
          select: {
            quantity: true,
            unitPrice: true,
            productId: true,
            product: { select: { name: true, tvaVente: true } },
          },
        },
      },
    });

    if (sales.length !== uniqueSaleIds.length) {
      throw new Error("Une ou plusieurs ventes sont introuvables ou déjà facturées.");
    }

    const clients = new Set(sales.map((sale) => sale.clientId ?? ""));
    if (clients.size > 1) {
      // Grouping is meant for one payer; mixing clients on a single
      // invoice would misstate who owes what.
      throw new Error("Les ventes groupées doivent appartenir au même client.");
    }

    const lineInputs: InvoiceLineInput[] = sales.flatMap((sale) =>
      sale.items.map((item) => ({
        productId: item.productId,
        designation: item.product.name,
        quantity: item.quantity,
        unitPriceHt: Number(item.unitPrice),
        // A product with no tvaVente is billed at 0 % rather than guessing a rate.
        tvaRate: item.product.tvaVente === null ? 0 : Number(item.product.tvaVente),
      })),
    );

    const totals = computeInvoiceTotals(lineInputs);

    const pharmacy = await tx.pharmacy.findUniqueOrThrow({
      where: { id: user.pharmacyId },
      select: { name: true, address: true, phone: true, ice: true },
    });

    const issuedAt = new Date();
    const year = issuedAt.getFullYear();
    const sequence = await allocateSequence(tx, user.pharmacyId, year);

    const invoice = await tx.invoice.create({
      data: {
        pharmacyId: user.pharmacyId,
        number: formatInvoiceNumber(year, sequence),
        year,
        sequence,
        issuedAt,
        pharmacyName: pharmacy.name,
        pharmacyAddress: pharmacy.address,
        pharmacyPhone: pharmacy.phone,
        pharmacyIce: pharmacy.ice,
        clientId: sales[0]?.clientId ?? null,
        clientName: sales[0]?.client?.name ?? null,
        totalHt: new Prisma.Decimal(totals.totalHt),
        totalTva: new Prisma.Decimal(totals.totalTva),
        totalTtc: new Prisma.Decimal(totals.totalTtc),
        lines: {
          create: totals.lines.map((line) => ({
            productId: line.productId,
            designation: line.designation,
            quantity: line.quantity,
            unitPriceHt: new Prisma.Decimal(line.unitPriceHt),
            tvaRate: new Prisma.Decimal(line.tvaRate),
            totalHt: new Prisma.Decimal(line.totalHt),
            totalTva: new Prisma.Decimal(line.totalTva),
            totalTtc: new Prisma.Decimal(line.totalTtc),
          })),
        },
      },
      select: { id: true, number: true },
    });

    // Marks the sales billed, inside the same transaction, so a sale can
    // never end up on two invoices.
    await tx.sale.updateMany({
      where: { id: { in: uniqueSaleIds }, pharmacyId: user.pharmacyId },
      data: { invoiceId: invoice.id },
    });

    revalidatePath("/factures");
    return invoice;
  });
}

/**
 * Cancels an invoice. The row keeps its number forever — the counter is
 * never rewound — so re-billing the same sales issues a NEW number and
 * the cancelled one stays visible in the sequence. That's what makes the
 * numbering auditable: a missing number would look like a deleted
 * invoice, a reused one like a forged document.
 *
 * The sales are released so they can be billed again; otherwise a
 * mistaken invoice would strand them permanently.
 */
export async function cancelInvoice(id: string): Promise<void> {
  const user = await requireUser();

  await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id, pharmacyId: user.pharmacyId },
      select: { id: true, status: true },
    });
    if (!invoice) throw new Error("Facture introuvable.");
    if (invoice.status === "CANCELLED") return;

    await tx.invoice.update({ where: { id: invoice.id }, data: { status: "CANCELLED" } });
    await tx.sale.updateMany({ where: { invoiceId: invoice.id }, data: { invoiceId: null } });
  });

  revalidatePath("/factures");
}

export async function listInvoices(filters?: {
  search?: string;
  from?: string;
  to?: string;
}): Promise<InvoiceListItem[]> {
  const user = await requireUser();

  const search = filters?.search?.trim();
  const from = filters?.from ? new Date(filters.from) : undefined;
  // `to` is an inclusive calendar day in the UI, so push the bound to the
  // end of that day rather than midnight, which would exclude it.
  const to = filters?.to ? new Date(`${filters.to}T23:59:59.999`) : undefined;

  const invoices = await prisma.invoice.findMany({
    where: {
      pharmacyId: user.pharmacyId,
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: "insensitive" } },
              { clientName: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(from || to ? { issuedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    orderBy: { issuedAt: "desc" },
    select: { id: true, number: true, issuedAt: true, clientName: true, totalTtc: true, status: true },
  });

  return invoices.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    issuedAt: invoice.issuedAt,
    clientName: invoice.clientName,
    totalTtc: Number(invoice.totalTtc),
    status: invoice.status === "CANCELLED" ? "cancelled" : "issued",
  }));
}

export async function getInvoice(id: string): Promise<InvoiceDetail | null> {
  const user = await requireUser();

  const invoice = await prisma.invoice.findFirst({
    where: { id, pharmacyId: user.pharmacyId },
    include: { lines: true, sales: { select: { id: true } } },
  });
  if (!invoice) return null;

  return {
    id: invoice.id,
    number: invoice.number,
    issuedAt: invoice.issuedAt,
    clientName: invoice.clientName,
    status: invoice.status === "CANCELLED" ? "cancelled" : "issued",
    pharmacyName: invoice.pharmacyName,
    pharmacyAddress: invoice.pharmacyAddress,
    pharmacyPhone: invoice.pharmacyPhone,
    pharmacyIce: invoice.pharmacyIce,
    totalHt: Number(invoice.totalHt),
    totalTva: Number(invoice.totalTva),
    totalTtc: Number(invoice.totalTtc),
    lines: invoice.lines.map((line) => ({
      id: line.id,
      designation: line.designation,
      quantity: line.quantity,
      unitPriceHt: Number(line.unitPriceHt),
      tvaRate: Number(line.tvaRate),
      totalHt: Number(line.totalHt),
      totalTva: Number(line.totalTva),
      totalTtc: Number(line.totalTtc),
    })),
    saleIds: invoice.sales.map((sale) => sale.id),
  };
}
