"use server";

/**
 * Read/write facade for suppliers — same seam as lib/offline/products.ts.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { supplierFormSchema, type SupplierFormInput } from "@/lib/validations/orders";
import type { SupplierModel } from "@/lib/db/generated/models";

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

  revalidatePath("/dashboard/commandes/fournisseurs");
  return supplier;
}
