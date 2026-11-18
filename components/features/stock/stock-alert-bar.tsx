"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  CircleCheck,
  ClipboardPlus,
  Clock,
  Coins,
  Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EXPIRY_THRESHOLD_OPTIONS,
  getExpiryAlerts,
  getLowStockAlerts,
  type ExpiryThresholdDays,
  type ProductForAlerts,
} from "@/lib/stock/alerts";
import { prixAComplete, dirhamArrondi } from "@/lib/stock/prix";
import { DelaiPeremption } from "@/components/features/stock/delai-peremption";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Ce qu'il y a à faire aujourd'hui sur le stock, en une barre.
 *
 * Remplace deux encadrés côte à côte. Ils posaient trois problèmes :
 *
 *   - « Stock bas : 0 » occupait la moitié de la largeur et une centaine
 *     de pixels pour dire qu'il n'y avait rien à dire, repoussant sous la
 *     ligne de flottaison le tableau, qui est le vrai plan de travail ;
 *   - ils redisaient ce tableau, qui porte déjà un badge « Proche », un
 *     badge « Stock bas » et un filtre Statut — deux représentations des
 *     mêmes lignes, dont aucune ne faisait autorité ;
 *   - la liste des péremptions ne permettait pas de décider : ni quantité
 *     ni valeur, et un tri par date qui laissait deux produits « dans 8
 *     jours » côte à côte sans rien pour les départager.
 *
 * D'où : une pastille par sujet, seulement quand il y a matière, un zéro
 * qui garde sa place en gris — il dit que la vérification a tourné — et
 * une liste dépliable qui porte enfin de quoi trancher.
 */

export type StockScope = "peremption" | "stockBas" | "prix" | null;


function Pastille({
  actif,
  ton,
  icon: Icon,
  children,
  onClick,
  disabled,
}: {
  actif: boolean;
  ton: "danger" | "warning" | "neutre";
  icon: typeof Clock;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const tons = {
    danger:
      "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900",
    warning:
      "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900",
    neutre: "text-muted-foreground ring-transparent",
  } as const;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={onClick ? actif : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-sp-sm py-1 text-sm ring-1 ring-inset transition-colors",
        tons[ton],
        onClick && "hover:brightness-95 dark:hover:brightness-125",
        // L'état retenu se voit à l'anneau, pas à un changement de teinte :
        // la couleur code déjà la gravité, elle ne peut pas coder deux choses.
        actif && "ring-2 ring-offset-1 ring-offset-background",
        disabled && "cursor-default",
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      {children}
    </button>
  );
}

export function StockAlertBar({
  products,
  scope,
  onScopeChange,
}: {
  products: ProductForAlerts[];
  scope: StockScope;
  onScopeChange: (scope: StockScope) => void;
}) {
  const [seuil, setSeuil] = useState<ExpiryThresholdDays>(30);

  const peremptions = useMemo(() => getExpiryAlerts(products, seuil), [products, seuil]);
  const stockBas = useMemo(() => getLowStockAlerts(products), [products]);
  const prixManquants = useMemo(
    () => products.filter((p) => prixAComplete(p.price)),
    [products],
  );

  const valeurTotale = peremptions.reduce((somme, a) => somme + (a.valeurEnStock ?? 0), 0);
  const rienASignaler =
    peremptions.length === 0 && stockBas.length === 0 && prixManquants.length === 0;

  function basculer(cible: Exclude<StockScope, null>) {
    onScopeChange(scope === cible ? null : cible);
  }

  return (
    <Card>
      <CardContent className="space-y-sp-sm py-sp-sm">
        <div className="flex flex-wrap items-center gap-sp-sm">
          {rienASignaler ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <CircleCheck className="size-4 shrink-0 text-emerald-600" strokeWidth={1.75} aria-hidden />
              Rien à surveiller — ni stock bas, ni péremption sous {seuil} jours.
            </span>
          ) : (
            <>
              {peremptions.length > 0 && (
                <Pastille
                  actif={scope === "peremption"}
                  ton="danger"
                  icon={Clock}
                  onClick={() => basculer("peremption")}
                >
                  {peremptions.length} périment sous {seuil} j
                  {valeurTotale > 0 && ` · ${dirhamArrondi(valeurTotale)}`}
                </Pastille>
              )}

              {stockBas.length > 0 ? (
                <Pastille
                  actif={scope === "stockBas"}
                  ton="warning"
                  icon={Package}
                  onClick={() => basculer("stockBas")}
                >
                  {stockBas.length} en stock bas
                </Pastille>
              ) : (
                // Le zéro reste, en gris et sans bouton : il dit que la
                // vérification a bien tourné, sans coûter un encadré.
                <Pastille actif={false} ton="neutre" icon={Package} disabled>
                  Stock bas : aucun
                </Pastille>
              )}

              {prixManquants.length > 0 && (
                <Pastille
                  actif={scope === "prix"}
                  ton="warning"
                  icon={Coins}
                  onClick={() => basculer("prix")}
                >
                  {prixManquants.length} prix à compléter
                </Pastille>
              )}
            </>
          )}

          <div className="ml-auto">
            <Select
              value={String(seuil)}
              onValueChange={(value) => setSeuil(Number(value) as ExpiryThresholdDays)}
            >
              <SelectTrigger size="sm" className="w-24" aria-label="Horizon de péremption">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_THRESHOLD_OPTIONS.map((jours) => (
                  <SelectItem key={jours} value={String(jours)}>
                    {jours} jours
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {scope === "peremption" && peremptions.length > 0 && (
          <ul className="divide-y divide-border/60 border-t border-border/60 pt-sp-xs">
            {peremptions.map((alerte) => (
              <li key={alerte.productId}>
                <Link
                  href={`/dashboard/stock/produits/${alerte.productId}`}
                  className="flex items-center gap-sp-md rounded-lg px-sp-sm py-sp-xs transition-colors hover:bg-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">
                      {alerte.productName}
                    </span>
                    {/* Sans cette ligne, deux DOLIPRANE sont deux chaînes
                        identiques — l'un est un comprimé, l'autre un
                        suppositoire. */}
                    {alerte.productPrecision && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {alerte.productPrecision}
                      </span>
                    )}
                  </span>
                  {/* `tabular-nums` : sans lui les chiffres n'ont pas la même
                      largeur et les montants ne s'empilent pas droit. */}
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="block text-sm text-foreground">
                      {alerte.quantityInStock} u. en stock
                      {alerte.valeurEnStock !== null && ` · ${dirhamArrondi(alerte.valeurEnStock)}`}
                    </span>
                    <DelaiPeremption date={alerte.nearestExpiryDate} className="block text-xs" />
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                </Link>
              </li>
            ))}
          </ul>
        )}

        {scope === "stockBas" && stockBas.length > 0 && (
          <ul className="divide-y divide-border/60 border-t border-border/60 pt-sp-xs">
            {stockBas.map((alerte) => (
              <li key={alerte.productId} className="flex items-center gap-sp-xs">
                <Link
                  href={`/dashboard/stock/produits/${alerte.productId}`}
                  className="flex flex-1 items-center gap-sp-md rounded-lg px-sp-sm py-sp-xs transition-colors hover:bg-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">
                      {alerte.productName}
                    </span>
                    {alerte.productPrecision && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {alerte.productPrecision}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {alerte.quantityInStock} / seuil {alerte.lowStockThreshold}
                  </span>
                </Link>
                {/* Recommander est l'action qui suit presque toujours un
                    stock bas : elle garde son raccourci. */}
                <Link
                  href="/commandes/nouvelle"
                  aria-label={`Créer une commande pour ${alerte.productName}`}
                  title="Créer une commande"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                >
                  <ClipboardPlus className="size-4" strokeWidth={1.75} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
