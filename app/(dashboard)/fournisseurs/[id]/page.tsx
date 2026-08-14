import { notFound } from "next/navigation";
import { getSupplierDetail } from "@/lib/server/suppliers";
import { SupplierDetailView } from "@/components/features/suppliers/supplier-detail-view";

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supplier = await getSupplierDetail(id);
  if (!supplier) notFound();

  return <SupplierDetailView supplier={supplier} />;
}
