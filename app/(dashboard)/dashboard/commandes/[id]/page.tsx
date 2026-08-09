import { notFound } from "next/navigation";
import { getOrder } from "@/lib/server/orders";
import { ReceiveOrderForm } from "@/components/features/orders/receive-order-form";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) notFound();

  return <ReceiveOrderForm order={order} />;
}
