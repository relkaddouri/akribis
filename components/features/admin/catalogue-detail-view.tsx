"use client";

import { Snowflake, FileSignature } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DetailBlock, DetailGroup, DetailRow, YesNo } from "@/components/ui/detail-list";
import { CategorieBadge } from "@/components/features/catalogue/categorie-badge";
import { CatalogueFlagSwitch } from "@/components/features/admin/catalogue-flag-switch";
import { CataloguePhotoCarousel } from "@/components/features/admin/catalogue-photo-carousel";
import { TABLEAUX_SUBSTANCE } from "@/lib/validations/catalogue";
import type { CatalogueProduitRecord } from "@/lib/server/catalogue";

const TABLEAU_LABELS = new Map(TABLEAUX_SUBSTANCE.map((t) => [t.value, t.label]));

function dirham(value: number | null): string {
  if (value === null) return "—";
  return `${value.toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${value} %`;
}

/** One cell of the four-up summary at the top of the sheet. */
function Summary({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="bg-card px-sp-sm py-sp-xs">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "truncate text-sm",
          value ? "font-medium text-foreground" : "text-muted-foreground/50",
          mono && value && "font-mono",
        )}
        title={value ?? undefined}
      >
        {value || "—"}
      </p>
    </div>
  );
}

/**
 * A tab's body — full width. The readable-measure problem is solved on
 * the value itself (`max-w-prose` in DetailRow) rather than by narrowing
 * the whole card, so tables of short values still use the screen.
 */
function TabBody({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-sp-xl">{children}</CardContent>
    </Card>
  );
}

export function CatalogueDetailView({ produit }: { produit: CatalogueProduitRecord }) {
  const sousTitre = [produit.dosage, produit.formeGalenique].filter(Boolean).join(" · ");

  return (
    <div className="space-y-sp-lg">
      {/* Photos beside the identity block on a wide screen, stacked on a
          narrow one. The carousel is capped rather than fluid: a portrait
          box photo would otherwise push the whole identity card down the
          page on a laptop. The identity card stretches to the carousel's
          height on purpose; `justify-between` pushes the summary strip to
          the bottom edge so the extra height reads as breathing room
          rather than as a gap left under the content. */}
      <div className="grid gap-sp-lg lg:grid-cols-[minmax(0,22rem)_1fr]">
        <CataloguePhotoCarousel photos={produit.photos} alt={produit.nom} />

        <Card className="h-full">
          <CardContent className="flex h-full flex-col justify-between gap-sp-md">
            <div className="flex items-start justify-between gap-sp-md">
              <div className="min-w-0 space-y-sp-xs">
                <h2 className="font-heading text-2xl font-bold text-foreground">{produit.nom}</h2>
                {sousTitre && <p className="text-muted-foreground">{sousTitre}</p>}
              </div>

              {/* En haut de la fiche, pas dans un onglet : c'est le statut
                  qu'on vient vérifier ou changer, il ne doit pas demander
                  un clic pour être vu. Il porte son propre état, ce qui
                  rend le badge « Actif » redondant — donc retiré. */}
              <div className="flex shrink-0 items-center gap-sp-sm rounded-lg border border-border px-sp-sm py-sp-xs">
                <CatalogueFlagSwitch
                  produitId={produit.id}
                  flag="actifCatalogue"
                  value={produit.actifCatalogue}
                  label={`${produit.actifCatalogue ? "Désactiver" : "Réactiver"} ${produit.nom}`}
                  showState
                  stateLabels={{ on: "Actif", off: "Inactif" }}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-sp-sm">
              <CategorieBadge categorie={produit.categorie} />

              {produit.remboursable && <Badge variant="secondary">Remboursable</Badge>}

              {/* Two facts a pharmacist acts on immediately: an ordonnance to
                  ask for, and a cold chain to respect on arrival. */}
              {produit.necessitePrescription && (
                <Badge variant="outline">
                  <FileSignature className="size-3" strokeWidth={2} aria-hidden />
                  Sur ordonnance
                </Badge>
              )}
              {produit.refrigerationRequise && (
                <Badge variant="outline">
                  <Snowflake className="size-3" strokeWidth={2} aria-hidden />
                  Conservation au froid
                </Badge>
              )}
              {!produit.produitCommercialise && (
                <Badge variant="destructive">Non commercialisé</Badge>
              )}
            </div>

            {/* The four things looked up most often, so they are readable
                without opening a tab. Deliberately styled differently from
                the tab rows — a summary, not a fifth list to scan. */}
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border sm:grid-cols-4">
              <Summary label="Code-barres" value={produit.codeBarres} mono />
              <Summary label="DCI" value={produit.dci} />
              <Summary label="Laboratoire" value={produit.laboratoire} />
              <Summary label="PPV" value={dirham(produit.ppv)} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="identification" className="gap-sp-md">
        <TabsList>
          <TabsTrigger value="identification">Identification</TabsTrigger>
          <TabsTrigger value="prix">Prix et fiscalité</TabsTrigger>
          <TabsTrigger value="descriptif">Descriptif</TabsTrigger>
        </TabsList>

        <TabsContent value="identification">
          <TabBody>
            <DetailGroup title="Identité">
              <DetailRow label="Code-barres" value={produit.codeBarres} />
              <DetailRow label="DCI" value={produit.dci} />
              <DetailRow label="Laboratoire" value={produit.laboratoire} />
              <DetailRow label="Forme galénique" value={produit.formeGalenique} />
            </DetailGroup>

            <DetailGroup title="Classification">
              <DetailRow
                label="Classe thérapeutique"
                value={produit.classeTherapeutique}
                prose
              />
              <DetailRow
                label="Tableau"
                value={TABLEAU_LABELS.get(produit.produitTableau) ?? produit.produitTableau}
              />
              <DetailRow label="Gamme" value={produit.gamme} />
              <DetailRow label="Sous-gamme" value={produit.sousGamme} />
              <DetailRow label="Groupe de produits" value={produit.groupeProduits} />
            </DetailGroup>

            {/* Modifiables ici, contrairement au reste de la fiche : ce sont
                trois bascules que l'Admin ajuste souvent, et passer par le
                formulaire en trois étapes pour un booléen serait absurde.
                Chacune demande confirmation — la portée est nationale. */}
            <DetailGroup title="Conditions de délivrance">
              <DetailRow
                label="Prescription requise"
                value={
                  <CatalogueFlagSwitch
                    produitId={produit.id}
                    flag="necessitePrescription"
                    value={produit.necessitePrescription}
                    label="Prescription requise"
                    showState
                  />
                }
              />
              <DetailRow
                label="Réfrigération"
                value={
                  <CatalogueFlagSwitch
                    produitId={produit.id}
                    flag="refrigerationRequise"
                    value={produit.refrigerationRequise}
                    label="Conservation au froid"
                    showState
                  />
                }
              />
              <DetailRow
                label="Commercialisé"
                value={
                  <CatalogueFlagSwitch
                    produitId={produit.id}
                    flag="produitCommercialise"
                    value={produit.produitCommercialise}
                    label="Produit commercialisé"
                    showState
                  />
                }
              />
            </DetailGroup>
          </TabBody>
        </TabsContent>

        <TabsContent value="prix">
          <TabBody>
            <DetailGroup title="Prix réglementés">
              <DetailRow label="PPH" value={dirham(produit.pph)} />
              <DetailRow label="PPV" value={dirham(produit.ppv)} />
            </DetailGroup>

            <DetailGroup title="Fiscalité">
              <DetailRow label="TVA achat" value={percent(produit.tvaAchat)} />
              <DetailRow label="TVA vente" value={percent(produit.tvaVente)} />
            </DetailGroup>

            <DetailGroup title="Remboursement">
              <DetailRow label="Remboursable" value={<YesNo value={produit.remboursable} />} />
              <DetailRow label="Taux de remboursement" value={percent(produit.tauxRemboursement)} />
              <DetailRow
                label="Prix base de remboursement"
                value={dirham(produit.prixBaseRemboursement)}
              />
            </DetailGroup>
          </TabBody>
        </TabsContent>

        <TabsContent value="descriptif">
          <TabBody>
            <DetailGroup title="Présentation">
              <DetailRow label="Description" value={produit.description} prose />
              <DetailRow label="Indications" value={produit.indications} prose />
              <DetailRow label="Excipients" value={produit.excipients} prose />
              <DetailRow label="Conditionnement" value={produit.conditionnement} />
              <DetailRow label="Référence laboratoire" value={produit.referenceLabo} />
            </DetailGroup>

            <DetailGroup title="Posologie">
              <DetailRow label="Adulte" value={produit.posologieAdulte} prose />
              <DetailRow label="Enfant" value={produit.posologieEnfant} prose />
            </DetailGroup>

            {/* Grouped under one heading, so three related warnings read as
                one block instead of three lookalike paragraphs. */}
            <DetailGroup title="Contre-indications">
              <DetailRow label="Conduite" value={produit.contreIndicationConduite} prose />
              <DetailRow label="Allaitement" value={produit.contreIndicationAllaitement} prose />
              <DetailRow label="Grossesse" value={produit.contreIndicationGrossesse} prose />
            </DetailGroup>

            <section className="space-y-sp-xs">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Monographie
              </h3>
              <DetailBlock value={produit.monographie} />
            </section>
          </TabBody>
        </TabsContent>
      </Tabs>
    </div>
  );
}
