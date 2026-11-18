import Link from "next/link";
import { notFound } from "next/navigation";
import { BookMarked, Pencil } from "lucide-react";
import { getCatalogueNeighbours, getCatalogueProduit } from "@/lib/server/catalogue";
import { ADMIN_CATALOGUE_PATH } from "@/lib/auth/access-control";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { CatalogueDetailView } from "@/components/features/admin/catalogue-detail-view";
import { CataloguePager } from "@/components/features/admin/catalogue-pager";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Fiche catalogue — Akribis" };

/**
 * Read-only consultation sheet. Editing lives at `[id]/modifier`, reached
 * only through the "Modifier" button here — same split as the pharmacy
 * product sheet at /dashboard/stock/produits/[id].
 */
export default async function FicheCataloguePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const produit = await getCatalogueProduit(id);
  if (!produit) notFound();

  const { precedent, suivant } = await getCatalogueNeighbours(id);

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title={produit.nom}
        subtitle={[produit.dosage, produit.formeGalenique].filter(Boolean).join(" · ")}
        icon={<BookMarked />}
        space="admin"
        backHref={ADMIN_CATALOGUE_PATH}
        backLabel="Catalogue"
        actions={
          <div className="flex items-center gap-sp-sm">
            <CataloguePager precedent={precedent} suivant={suivant} />
            <Button asChild size="sm">
              <Link href={`${ADMIN_CATALOGUE_PATH}/${produit.id}/modifier`}>
                <Pencil /> Modifier
              </Link>
            </Button>
          </div>
        }
      />

      <CatalogueDetailView produit={produit} />
    </div>
  );
}
