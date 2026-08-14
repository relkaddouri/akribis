import { notFound } from "next/navigation";
import { getSupplierCredit } from "@/lib/server/supplier-credits";
import { CreditDetailView } from "@/components/features/suppliers/credit-detail-view";

export default async function CreditDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const credit = await getSupplierCredit(id);
  if (!credit) notFound();

  return <CreditDetailView credit={credit} />;
}
