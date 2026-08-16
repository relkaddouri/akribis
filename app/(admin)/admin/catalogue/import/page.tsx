import { Upload } from "lucide-react";
import { ADMIN_CATALOGUE_PATH } from "@/lib/auth/access-control";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { CatalogueImport } from "@/components/features/admin/catalogue-import";

export const metadata = { title: "Import catalogue — Akribis" };

export default function ImportCataloguePage() {
  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Importer un référentiel"
        subtitle="Fichier Excel ou CSV — rien n'est écrit avant votre confirmation"
        icon={<Upload />}
        space="admin"
        backHref={ADMIN_CATALOGUE_PATH}
        backLabel="Catalogue"
      />
      <CatalogueImport />
    </div>
  );
}
