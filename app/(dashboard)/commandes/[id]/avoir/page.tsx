import { notFound } from "next/navigation";
import { getOrder } from "@/lib/server/orders";
import { listCreditableProductsForOrder } from "@/lib/server/supplier-credits";
import { CreateCreditForm } from "@/components/features/suppliers/create-credit-form";

export default async function CreateCreditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [order, products] = await Promise.all([
    getOrder(id),
    listCreditableProductsForOrder(id),
  ]);
  if (!order) notFound();

  return (
    <CreateCreditForm
      orderId={order.id}
      orderNumero={order.numero}
      supplierId={order.supplierId}
      supplierName={order.supplierName}
      products={products}
    />
  );
}
