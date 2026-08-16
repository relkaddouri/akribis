import { CatalogueWizard } from "@/components/features/admin/catalogue-wizard/catalogue-wizard";

export const metadata = { title: "Nouvelle fiche catalogue — Akribis" };

export default function NouvelleFicheCataloguePage() {
  return <CatalogueWizard mode="create" />;
}
