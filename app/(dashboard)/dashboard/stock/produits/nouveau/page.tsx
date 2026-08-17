import { listSuppliers } from "@/lib/server/suppliers";
import { CatalogueEntryFlow } from "@/components/features/stock/catalogue-entry/catalogue-entry-flow";

export const metadata = { title: "Ajouter un produit — Akribis" };

/**
 * Catalogue-first stock entry. The full manual fiche lives one level down
 * at `nouveau/manuel`, still reachable from here when the catalogue has no
 * match or the network is down.
 */
export default async function NewStockEntryPage() {
  const suppliers = await listSuppliers();

  return (
    <CatalogueEntryFlow
      suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
    />
  );
}
