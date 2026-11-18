import { notFound } from "next/navigation";
import { getCatalogueProduit } from "@/lib/server/catalogue";
import { CatalogueWizard } from "@/components/features/admin/catalogue-wizard/catalogue-wizard";

export const metadata = { title: "Modifier une fiche catalogue — Akribis" };

export default async function FicheCataloguePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const produit = await getCatalogueProduit(id);
  if (!produit) notFound();

  return <CatalogueWizard mode="edit" produit={produit} />;
}
