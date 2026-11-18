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
import { estRenseigne, profilDe } from "@/lib/catalogue/profil-fiche";
import { CategorieBadge } from "@/components/features/catalogue/categorie-badge";
import { ProductActifSwitch } from "@/components/features/stock/product-actif-switch";
import { PrixACompleter } from "@/components/features/stock/prix-a-completer";
import { prixAComplete, valeurDuStock, dirhamArrondi } from "@/lib/stock/prix";
import { DelaiPeremption } from "@/components/features/stock/delai-peremption";
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
/**
 * La prochaine péremption, en tenant compte des **deux** sources.
 *
 * Elle n'en lisait qu'une : les lots. Or la barre d'alertes du stock lit
 * la date portée par le produit lui-même — celle qu'on saisit à la
 * création — et les deux ne coïncident pas. Sur un produit sans lot daté,
 * la fiche annonçait « hors alertes FEFO » pendant que la liste, deux
 * écrans plus haut, l'affichait en alerte à huit jours. Les deux disaient
 * vrai de leur point de vue, ce qui est la pire façon de se contredire.
 *
 * On prend donc la plus proche des deux, et on dit d'où elle vient quand
 * elle ne vient pas d'un lot : c'est ce qui explique au pharmacien
 * pourquoi la sortie FEFO ne pourra pas s'appuyer dessus.
 */
function NextExpiry({
  lots,
  dateProduit,
}: {
  lots: StockSheet["lots"];
  dateProduit: Date | string | null;
}) {
  // `lots` arrive déjà trié par date croissante côté serveur.
  const premierLotDate = lots.find((lot) => lot.datePeremption !== null)?.datePeremption ?? null;
  const duProduit = dateProduit ? new Date(dateProduit) : null;

  const candidats = [premierLotDate, duProduit].filter((d): d is Date => d !== null);
  const prochaine = candidats.length > 0
    ? candidats.reduce((plusProche, d) => (d < plusProche ? d : plusProche))
    : null;

  if (prochaine === null) {
    return (
      <span className="inline-flex flex-wrap items-center gap-sp-sm">
        <span className="text-muted-foreground">
          {lots.length === 0 ? "Aucun lot enregistré" : "Aucune date de péremption connue"}
        </span>
        <Button asChild size="sm" variant="outline">
          <Link href="/commandes">
            <PackagePlus /> Enregistrer une réception
          </Link>
        </Button>
      </span>
    );
  }

  const sansLotDate = premierLotDate === null;

  return (
    <span className="inline-flex flex-wrap items-center gap-sp-sm">
      <span>{formatDate(prochaine)}</span>
      <DelaiPeremption date={prochaine} />
      {sansLotDate && (
        <span className="text-xs text-muted-foreground">
          saisie sur la fiche, aucun lot daté — la sortie FEFO ne peut pas s&apos;y fier
        </span>
      )}
    </span>
  );
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

  // Même règle que la fiche catalogue Admin : les sections suivent la
  // famille du produit, mais aucune donnée renseignée n'est escamotée.
  const estPara = profilDe(local?.categorie) === "parapharmacie";
  const valeur = valeurDuStock(product.price, product.quantityInStock);

  // Le sous-titre dit ce qui identifie le produit dans SA famille : dosage
  // et forme pour un médicament, marque et rayon pour de la parapharmacie —
  // même règle que la fiche catalogue côté Admin.
  const sousTitre = estPara
    ? [local?.marque, local?.categoriePrincipale, local?.sousCategorie]
        .filter(Boolean)
        .join(" · ")
    : [product.dosage, product.form].filter(Boolean).join(" · ");

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
            <div className="flex items-start justify-between gap-sp-md">
              <div className="space-y-sp-xs">
                <h2 className="font-heading text-2xl font-bold text-foreground">{product.name}</h2>
                {sousTitre && <p className="text-muted-foreground">{sousTitre}</p>}
                {/* La famille en haut de fiche, hors des onglets : les onglets
                    Stock et Organisation sont identiques dans les deux profils,
                    si rien ne la dit ici la fiche d'un produit para se lit
                    exactement comme celle d'un médicament. */}
                <CategorieBadge categorie={local?.categorie} />
              </div>

              {/* En haut de fiche et non dans un onglet : c'est un statut,
                  il doit se voir sans qu'on aille le chercher. */}
              <div className="flex shrink-0 items-center gap-sp-sm rounded-lg border border-border px-sp-sm py-sp-xs">
                <ProductActifSwitch
                  productId={product.id}
                  productName={product.name}
                  value={product.actifLocalement}
                  quantityInStock={product.quantityInStock}
                  showState
                />
              </div>
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
                {/* Ce que ce stock représente — la même valeur, calculée au
                    même endroit, que celle annoncée par la barre d'alertes. */}
                <DetailRow
                  label="Valeur du stock"
                  value={
                    valeur !== null ? (
                      <span className="tabular-nums">{dirhamArrondi(valeur)}</span>
                    ) : (
                      <span className="text-muted-foreground">
                        Inconnue — le prix de vente reste à compléter
                      </span>
                    )
                  }
                />
                <DetailRow
                  label="Prochaine péremption"
                  value={<NextExpiry lots={lots} dateProduit={product.nearestExpiryDate} />}
                />
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
              {estPara ? (
                <>
                  <DetailGroup title="Identité">
                    <DetailRow label="Marque" value={local?.marque ?? null} />
                    <DetailRow label="Code-barres" value={product.barcode} />
                    <DetailRow label="Conditionnement" value={local?.conditionnement ?? null} />
                  </DetailGroup>

                  <DetailGroup title="Rayon">
                    <DetailRow label="Catégorie principale" value={local?.categoriePrincipale ?? null} />
                    <DetailRow label="Sous-catégorie" value={local?.sousCategorie ?? null} />
                    <DetailRow label="Sous-sous-catégorie" value={local?.sousSousCategorie ?? null} />
                    <DetailRow label="Étiquettes" value={local?.etiquettes ?? null} prose />
                  </DetailGroup>

                  {[product.dci, product.laboratory, product.dosage].some(estRenseigne) && (
                    <DetailGroup title="Autres informations renseignées">
                      {estRenseigne(product.dci) && <DetailRow label="DCI" value={product.dci} />}
                      {estRenseigne(product.laboratory) && (
                        <DetailRow label="Laboratoire" value={product.laboratory} />
                      )}
                      {estRenseigne(product.dosage) && (
                        <DetailRow label="Dosage" value={product.dosage} />
                      )}
                    </DetailGroup>
                  )}
                </>
              ) : (
                <DetailGroup title="Identification">
                  <DetailRow label="Code-barres" value={product.barcode} />
                  <DetailRow label="DCI" value={product.dci} />
                  <DetailRow label="Laboratoire" value={product.laboratory} />
                  <DetailRow label="Forme galénique" value={product.form} />
                  <DetailRow label="Dosage" value={product.dosage} />
                  <DetailRow label="Conditionnement" value={local?.conditionnement ?? null} />
                </DetailGroup>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prix">
          <Card>
            <CardContent className="space-y-sp-xl">
              <DetailGroup title="Prix">
                <DetailRow
                  label="Prix de vente"
                  value={
                    prixAComplete(product.price) ? (
                      <PrixACompleter
                        productId={product.id}
                        ppv={sheet.catalogue?.ppv ?? null}
                        prixVenteIndicatif={local?.prixVenteIndicatif ?? null}
                      />
                    ) : (
                      dirham(product.price)
                    )
                  }
                />
                <DetailRow
                  label="Prix d'achat"
                  value={dirham(local?.prixAchat ?? product.purchasePrice)}
                />
                {estPara ? (
                  <DetailRow
                    label="Prix indicatif catalogue"
                    value={dirham(local?.prixVenteIndicatif ?? null)}
                  />
                ) : (
                  <DetailRow label="PPH" value={dirham(product.pph)} />
                )}
              </DetailGroup>

              <DetailGroup title="Fiscalité">
                <DetailRow label="TVA vente" value={tvaValue("tvaVente")} />
                <DetailRow label="TVA achat" value={tvaValue("tvaAchat")} />
              </DetailGroup>

              {estPara ? (
                <>
                  <p className="max-w-prose text-sm text-muted-foreground">
                    Prix libre : la parapharmacie n&apos;est pas réglementée. Le prix indicatif du
                    catalogue n&apos;est qu&apos;un point de départ.
                  </p>
                  {(product.remboursable || estRenseigne(product.pph)) && (
                    <DetailGroup title="Autres informations renseignées">
                      {estRenseigne(product.pph) && (
                        <DetailRow label="PPH" value={dirham(product.pph)} />
                      )}
                      {product.remboursable && (
                        <>
                          <DetailRow label="Remboursable" value={<YesNo value={product.remboursable} />} />
                          <DetailRow
                            label="Base de remboursement"
                            value={dirham(product.baseRemboursement)}
                          />
                        </>
                      )}
                    </DetailGroup>
                  )}
                </>
              ) : (
                <DetailGroup title="Remboursement">
                  <DetailRow label="Remboursable" value={<YesNo value={product.remboursable} />} />
                  <DetailRow
                    label="Base de remboursement"
                    value={dirham(product.baseRemboursement)}
                  />
                </DetailGroup>
              )}
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
              {estPara && (
                <DetailGroup title="Présentation">
                  <DetailRow label="Description" value={local?.description ?? null} prose />
                  <DetailRow label="Étiquettes" value={local?.etiquettes ?? null} prose />
                </DetailGroup>
              )}

              {/* Posologie, indications, contre-indications et monographie
                  n'ont pas de sens sur un shampooing — mais si quelqu'un les
                  a renseignées, elles restent visibles. */}
              {(!estPara ||
                [product.posologieAdulte, product.posologieEnfant].some(estRenseigne)) && (
                <DetailGroup title="Posologie">
                  <DetailRow label="Adulte" value={product.posologieAdulte} prose />
                  <DetailRow label="Enfant" value={product.posologieEnfant} prose />
                </DetailGroup>
              )}

              {(!estPara || estRenseigne(local?.indications)) && (
                <DetailGroup title="Indications">
                  <DetailRow label="Indications" value={local?.indications ?? null} prose />
                </DetailGroup>
              )}

              {(!estPara ||
                [
                  local?.contreIndicationConduite,
                  local?.contreIndicationAllaitement,
                  local?.contreIndicationGrossesse,
                ].some(estRenseigne)) && (
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
              )}

              {(!estPara || estRenseigne(product.monographie)) && (
                <DetailGroup title="Monographie">
                  <DetailRow label="Monographie" value={product.monographie} prose />
                </DetailGroup>
              )}
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
