import { notFound } from "next/navigation";
import { getSale } from "@/lib/server/sales-returns";
import { SaleDetailView } from "@/components/features/sales/sale-detail-view";

export default async function VenteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sale = await getSale(id);
  if (!sale) notFound();

  return <SaleDetailView sale={sale} />;
}
