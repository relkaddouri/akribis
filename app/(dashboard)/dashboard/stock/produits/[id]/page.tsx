import Link from "next/link";
import { notFound } from "next/navigation";
import { ImageOff, Package, Pencil } from "lucide-react";
import { getProduct } from "@/lib/server/products";
import { isLowStock } from "@/lib/stock/alerts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";

function formatDate(date: Date | null): string {
  return date ? date.toLocaleDateString("fr-FR") : "—";
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value ?? "—"}</p>
    </div>
  );
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) notFound();

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title={product.name}
        subtitle={`${product.form}${product.dosage ? ` · ${product.dosage}` : ""}`}
        icon={<Package />}
        backHref="/dashboard/stock"
        backLabel="Stock"
        actions={
          <Button asChild>
            <Link href={`/dashboard/stock/produits/${product.id}/modifier`}>
              <Pencil className="size-4" />
              Modifier
            </Link>
          </Button>
        }
      />

      <div className="max-w-2xl space-y-sp-lg">
        <Card>
          <CardContent className="flex items-center gap-sp-md">
            <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
              {product.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL
                <img src={product.photoUrl} alt={product.name} className="size-full object-cover" />
              ) : (
                <ImageOff className="size-6 text-muted-foreground" strokeWidth={1.5} />
              )}
            </div>
            <div className="min-w-0 space-y-sp-sm">
              <p className="font-heading text-base font-bold text-foreground">{product.name}</p>
              <div className="flex flex-wrap gap-sp-sm">
                {product.category && <Badge variant="secondary">{product.category}</Badge>}
                {isLowStock(product) && <Badge variant="destructive">Stock bas</Badge>}
                {product.remboursable && <Badge>Remboursable</Badge>}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Informations générales</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Laboratoire" value={product.laboratory} />
            <Field label="Code-barres" value={product.barcode} />
            <Field label="DCI" value={product.dci} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Prix et fiscalité</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Prix de vente" value={product.price.toFixed(2)} />
            <Field label="PPH" value={product.pph !== null ? product.pph.toFixed(2) : null} />
            <Field label="TVA vente" value={product.tvaVente !== null ? `${product.tvaVente}%` : null} />
            <Field label="TVA achat" value={product.tvaAchat !== null ? `${product.tvaAchat}%` : null} />
            <Field label="Quantité en stock" value={product.quantityInStock} />
            <Field label="Seuil d'alerte stock bas" value={product.lowStockThreshold} />
            <Field label="Date de péremption" value={formatDate(product.nearestExpiryDate)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Remboursement</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Remboursable" value={product.remboursable ? "Oui" : "Non"} />
            {product.remboursable && (
              <Field
                label="Base de remboursement"
                value={product.baseRemboursement !== null ? product.baseRemboursement.toFixed(2) : null}
              />
            )}
          </CardContent>
        </Card>

        {(product.posologieEnfant || product.posologieAdulte || product.monographie) && (
          <Card>
            <CardHeader>
              <CardTitle>Posologie et monographie</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Posologie enfant" value={product.posologieEnfant} />
                <Field label="Posologie adulte" value={product.posologieAdulte} />
              </div>
              {product.monographie && (
                <div>
                  <p className="text-sm text-muted-foreground">Monographie</p>
                  <p className="whitespace-pre-wrap text-foreground">{product.monographie}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
