"use client";

import Link from "next/link";
import { PackagePlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DetailGroup, DetailRow, YesNo } from "@/components/ui/detail-list";
import { CataloguePhotoCarousel } from "@/components/features/admin/catalogue-photo-carousel";
import { TvaToComplete } from "@/components/features/stock/tva-to-complete";
import { missingTvaFields } from "@/lib/stock/tva";
import type { ProductRecord } from "@/lib/server/products";
import type { StockSheet } from "@/lib/server/stock-entry";

/**
 * The pharmacy's stock sheet, tabbed on the same split as the admin
 * catalogue sheet — the two pages describe the same object from two sides,
 * and a pharmacist who has seen one should not have to relearn the other.
 *
 * Everything here belongs to the pharmacy and is editable through
 * "Modifier"; nothing is presented as locked. What the page adds is
 * *reading* help: which gaps matter, and which are simply optional.
 */

function dirham(value: number | null): string {
  if (value === null) return "—";
  return `${value.toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${value} %`;
}

function formatDate(date: Date | string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("fr-FR");
}

/**
 * Next expiry, derived from the lots that still hold units — never a field
 * anyone types. A date entered by hand drifts away from the boxes on the
 * shelf the first time a lot runs out.
 */
function NextExpiry({ lots }: { lots: StockSheet["lots"] }) {
  const dated = lots.filter((lot) => lot.datePeremption !== null);

  if (lots.length === 0) {
    return (
      <span className="inline-flex flex-wrap items-center gap-sp-sm">
        <span className="text-muted-foreground">Aucun lot enregistré</span>
        <Button asChild size="sm" variant="outline">
          <Link href="/commandes">
            <PackagePlus /> Enregistrer une réception
          </Link>
        </Button>
      </span>
    );
  }

  if (dated.length === 0) {
    return <span className="text-muted-foreground">Aucun lot daté — hors alertes FEFO</span>;
  }

  // `lots` arrive déjà triés par date croissante côté serveur.
  return <span>{formatDate(dated[0]!.datePeremption)}</span>;
}

export function StockDetailView({
  product,
  sheet,
}: {
  product: ProductRecord;
  sheet: StockSheet;
}) {
  const { local, lots, photos } = sheet;
  const tvaManquantes = missingTvaFields(product);

  /**
   * Les photos de la fiche catalogue si elle en a, sinon la photo unique
   * du produit — celle qu'un pharmacien a téléversée depuis le formulaire
   * pour un produit saisi à la main. Sans ce repli, ces produits-là
   * perdaient leur image.
   *
   * Le carrousel est toujours rendu : il gère lui-même le cas « une seule
   * photo » (sans contrôles inutiles) et le cas « aucune » (tuile neutre),
   * exactement comme sur la fiche catalogue Admin.
   */
  const visuels =
    photos.length > 0
      ? photos
      : product.photoUrl
        ? [{ id: "produit", url: product.photoUrl, ordre: 0 }]
        : [];

  const tvaValue = (field: "tvaVente" | "tvaAchat") =>
    tvaManquantes.includes(field) ? (
      <TvaToComplete productId={product.id} field={field} categorie={local?.categorie ?? null} />
    ) : (
      percent(product[field])
    );

  return (
    <div className="space-y-sp-lg">
      <div className="grid items-start gap-sp-lg lg:grid-cols-[minmax(0,22rem)_1fr]">
        <CataloguePhotoCarousel photos={visuels} alt={product.name} />
        <Card className="h-full">
          <CardContent className="space-y-sp-md">
            <div className="space-y-sp-xs">
              <h2 className="font-heading text-2xl font-bold text-foreground">{product.name}</h2>
              <p className="text-muted-foreground">
                {[product.dosage, product.form].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Marqueurs product={product} lots={lots} />
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="stock" className="gap-sp-md">
        <TabsList>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="identification">Identification</TabsTrigger>
          <TabsTrigger value="prix">Prix et fiscalité</TabsTrigger>
          <TabsTrigger value="organisation">Organisation</TabsTrigger>
          <TabsTrigger value="descriptif">Descriptif</TabsTrigger>
        </TabsList>

        <TabsContent value="stock">
          <Card>
            <CardContent className="space-y-sp-xl">
              <DetailGroup title="Quantités">
                <DetailRow label="Quantité en stock" value={product.quantityInStock} />
                <DetailRow label="Seuil d'alerte" value={product.lowStockThreshold} />
                <DetailRow label="Prochaine péremption" value={<NextExpiry lots={lots} />} />
              </DetailGroup>

              <DetailGroup title={`Lots (${lots.length})`}>
                {lots.length === 0 ? (
                  <DetailRow
                    label="Lots"
                    value={
                      <span className="text-muted-foreground">
                        Aucun lot ne porte d&apos;unités pour ce produit.
                      </span>
                    }
                  />
                ) : (
                  lots.map((lot) => (
                    <DetailRow
                      key={lot.id}
                      label={lot.numeroLot ?? "Lot sans numéro"}
                      value={`${lot.quantite} unité${lot.quantite > 1 ? "s" : ""} · péremption ${formatDate(lot.datePeremption)}`}
                    />
                  ))
                )}
              </DetailGroup>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="identification">
          <Card>
            <CardContent>
              <DetailGroup title="Identification">
                <DetailRow label="Code-barres" value={product.barcode} />
                <DetailRow label="DCI" value={product.dci} />
                <DetailRow label="Laboratoire" value={product.laboratory} />
                <DetailRow label="Forme galénique" value={product.form} />
                <DetailRow label="Dosage" value={product.dosage} />
                <DetailRow label="Conditionnement" value={local?.conditionnement ?? null} />
              </DetailGroup>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prix">
          <Card>
            <CardContent className="space-y-sp-xl">
              <DetailGroup title="Prix">
                <DetailRow label="Prix de vente" value={dirham(product.price)} />
                <DetailRow
                  label="Prix d'achat"
                  value={dirham(local?.prixAchat ?? product.purchasePrice)}
                />
                <DetailRow label="PPH" value={dirham(product.pph)} />
              </DetailGroup>

              <DetailGroup title="Fiscalité">
                <DetailRow label="TVA vente" value={tvaValue("tvaVente")} />
                <DetailRow label="TVA achat" value={tvaValue("tvaAchat")} />
              </DetailGroup>

              <DetailGroup title="Remboursement">
                <DetailRow label="Remboursable" value={<YesNo value={product.remboursable} />} />
                <DetailRow
                  label="Base de remboursement"
                  value={dirham(product.baseRemboursement)}
                />
              </DetailGroup>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="organisation">
          <Card>
            <CardContent>
              <DetailGroup title="Organisation">
                <DetailRow label="Fournisseur" value={local?.supplierNom ?? null} />
                <DetailRow label="Référence interne" value={local?.referenceInterne ?? null} />
                <DetailRow label="Emplacement" value={local?.localisation ?? null} />
              </DetailGroup>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="descriptif">
          <Card>
            <CardContent className="space-y-sp-xl">
              <DetailGroup title="Posologie">
                <DetailRow label="Adulte" value={product.posologieAdulte} prose />
                <DetailRow label="Enfant" value={product.posologieEnfant} prose />
              </DetailGroup>

              <DetailGroup title="Indications">
                <DetailRow label="Indications" value={local?.indications ?? null} prose />
              </DetailGroup>

              <DetailGroup title="Contre-indications">
                <DetailRow label="Conduite" value={local?.contreIndicationConduite ?? null} prose />
                <DetailRow
                  label="Allaitement"
                  value={local?.contreIndicationAllaitement ?? null}
                  prose
                />
                <DetailRow
                  label="Grossesse"
                  value={local?.contreIndicationGrossesse ?? null}
                  prose
                />
              </DetailGroup>

              <DetailGroup title="Monographie">
                <DetailRow label="Monographie" value={product.monographie} prose />
              </DetailGroup>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Les repères lus en premier : rupture proche, remboursement, trous à combler. */
function Marqueurs({
  product,
  lots,
}: {
  product: ProductRecord;
  lots: StockSheet["lots"];
}) {
  const tvaManquantes = missingTvaFields(product);

  return (
    <div className="flex flex-wrap gap-sp-sm">
      {product.category && <Badge variant="secondary">{product.category}</Badge>}
      {product.quantityInStock <= product.lowStockThreshold && (
        <Badge variant="destructive">Stock bas</Badge>
      )}
      {product.remboursable && <Badge>Remboursable</Badge>}
      {lots.length === 0 && (
        <Badge variant="outline" className="text-amber-600">
          Aucun lot
        </Badge>
      )}
      {tvaManquantes.length > 0 && (
        <Badge variant="outline" className="text-amber-600">
          TVA à compléter
        </Badge>
      )}
    </div>
  );
}
