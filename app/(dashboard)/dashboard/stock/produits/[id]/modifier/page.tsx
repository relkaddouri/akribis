import { notFound } from "next/navigation";
import { getProduct } from "@/lib/server/products";
import { ProductWizard } from "@/components/features/stock/product-wizard/product-wizard";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) notFound();

  return <ProductWizard mode="edit" product={product} />;
}
