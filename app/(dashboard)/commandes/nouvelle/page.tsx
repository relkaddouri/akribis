import { NewOrderForm } from "@/components/features/orders/new-order-form";

export default async function NewOrderPage({
  searchParams,
}: {
  /** `?fournisseur=<id>` pre-selects a supplier, e.g. from their detail sheet. */
  searchParams: Promise<{ fournisseur?: string }>;
}) {
  const { fournisseur } = await searchParams;
  return <NewOrderForm initialSupplierId={fournisseur ?? ""} />;
}
