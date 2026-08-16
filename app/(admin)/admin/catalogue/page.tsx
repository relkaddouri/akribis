import Link from "next/link";
import { BookMarked, Plus, Upload } from "lucide-react";
import { listCatalogueProduits } from "@/lib/server/catalogue";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { CatalogueTable } from "@/components/features/admin/catalogue-table";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Catalogue produits — Akribis" };

export default async function AdminCataloguePage() {
  const produits = await listCatalogueProduits();

  const actifs = produits.filter((produit) => produit.actifCatalogue).length;
  const aClasser = produits.filter((produit) => produit.categorie === null).length;

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Catalogue produits"
        subtitle={
          produits.length === 0
            ? "Référentiel national partagé par toutes les pharmacies"
            : `${produits.length} fiche${produits.length > 1 ? "s" : ""} · ${actifs} active${actifs > 1 ? "s" : ""}` +
              (aClasser > 0 ? ` · ${aClasser} à classer` : "")
        }
        icon={<BookMarked />}
        space="admin"
        actions={
          <div className="flex items-center gap-sp-xs">
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/catalogue/import">
                <Upload /> Importer
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/admin/catalogue/nouveau">
                <Plus /> Nouvelle fiche
              </Link>
            </Button>
          </div>
        }
      />

      <CatalogueTable produits={produits} />
    </div>
  );
}
