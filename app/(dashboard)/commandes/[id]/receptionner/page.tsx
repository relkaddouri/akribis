import { notFound, redirect } from "next/navigation";
import { getOrder } from "@/lib/server/orders";
import { ReceiveOrderForm } from "@/components/features/orders/receive-order-form";

export default async function ReceiveOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) notFound();

  if (order.status === "RECUE" || order.status === "CLOTUREE") {
    redirect(`/commandes/${id}`);
  }

  return <ReceiveOrderForm order={order} />;
}
