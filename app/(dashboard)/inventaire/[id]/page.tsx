import { InventoryCountView } from "@/components/features/inventory/inventory-count-view";

/**
 * Reads its data from Dexie, not from the server, so a count survives the
 * stockroom losing signal. The route itself is still server-rendered —
 * see the caveat in the module's notes about page-cache warming.
 */
export default async function InventorySessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InventoryCountView sessionId={id} />;
}
