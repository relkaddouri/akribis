"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ImageOff,
  Lightbulb,
  Loader2,
  PackagePlus,
  PencilLine,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  addCatalogueProduitToStock,
  searchCatalogue,
  type CatalogueSearchHit,
} from "@/lib/server/stock-entry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { SuggestProductDialog } from "./suggest-product-dialog";

const STOCK_PATH = "/dashboard/stock";
const MANUAL_PATH = "/dashboard/stock/produits/nouveau/manuel";
const NO_SUPPLIER = "__none__";

export type SupplierOption = { id: string; name: string };

/**
 * Adding a product to stock, catalogue first.
 *
 * Two steps instead of the four-step full fiche: find the product in the
 * national catalogue, then fill in only what belongs to this pharmacy.
 * The whole fiche is copied across — identification, prices, descriptive —
 * and becomes the pharmacy's own, editable without any Admin approval. The
 * catalogue is a convenient starting point, not a source of truth, which is
 * why the only promise made here is "check it before adding it".
 *
 * Needs the network, unlike the manual form: the catalogue lives on the
 * server and is far too large to mirror into IndexedDB. That is why the
 * manual form stays reachable, and why a failed search says so instead of
 * pretending the product does not exist.
 */
export function CatalogueEntryFlow({ suppliers }: { suppliers: SupplierOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<CatalogueSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selected, setSelected] = useState<CatalogueSearchHit | null>(null);
  const [supplierId, setSupplierId] = useState<string>(NO_SUPPLIER);
  const [quantite, setQuantite] = useState("0");
  const [seuil, setSeuil] = useState("0");
  const [prixAchat, setPrixAchat] = useState("");
  const [reference, setReference] = useState("");
  const [localisation, setLocalisation] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const term = debounced.trim();
    if (term.length < 2) {
      setResults(null);
      setSearchError(null);
      return;
    }

    let cancelled = false;
    setSearching(true);
    searchCatalogue(term)
      .then((hits) => {
        if (cancelled) return;
        setResults(hits);
        setSearchError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setResults(null);
        setSearchError(
          "Recherche impossible — le catalogue nécessite une connexion. " +
            "Vous pouvez saisir le produit manuellement en attendant.",
        );
      })
      .finally(() => !cancelled && setSearching(false));

    return () => {
      cancelled = true;
    };
  }, [debounced]);

  function submit() {
    if (!selected) return;
    setSubmitError(null);
    setExistingId(null);

    startTransition(async () => {
      const result = await addCatalogueProduitToStock({
        catalogueProduitId: selected.id,
        supplierId: supplierId === NO_SUPPLIER ? "" : supplierId,
        quantiteInitiale: quantite,
        seuilAlerte: seuil,
        prixAchat,
        referenceInterne: reference,
        localisation,
      });

      if (!result.ok) {
        setSubmitError(result.error);
        setExistingId(result.productId ?? null);
        return;
      }
      router.push(`/dashboard/stock/produits/${result.productId}`);
      router.refresh();
    });
  }

  // ------------------------------------------------------- Étape 2
  if (selected) {
    return (
      <div className="space-y-sp-lg">
        <DashboardHeader
          title="Ajouter au stock"
          subtitle={selected.nom}
          icon={<PackagePlus />}
          backHref={STOCK_PATH}
          backLabel="Stock"
        />

        <div className="mx-auto w-full max-w-2xl space-y-sp-lg">
          <Card>
            <CardContent className="flex items-start gap-sp-md">
              <Thumbnail url={selected.photoUrl} />
              <div className="min-w-0 flex-1 space-y-sp-xs">
                <p className="font-heading text-base font-bold text-foreground">{selected.nom}</p>
                <p className="text-sm text-muted-foreground">
                  {[selected.dosage, selected.formeGalenique, selected.laboratoire]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <div className="flex flex-wrap items-center gap-sp-sm pt-sp-xs text-sm">
                  {selected.dci && <Badge variant="outline">{selected.dci}</Badge>}
                  {selected.ppv !== null && (
                    <span className="text-muted-foreground">
                      PPV {selected.ppv.toFixed(2)} DH
                    </span>
                  )}
                </div>
                {/* Exactement ce qui a été demandé, et rien de plus : aucune
                    promesse sur l'exactitude des données du catalogue, qui
                    n'est qu'un point de départ. */}
                <p className="pt-sp-xs text-xs text-muted-foreground">
                  Vérifiez ces informations avant de les ajouter à votre stock.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Changer
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <p className="text-sm text-muted-foreground sm:col-span-2">
                Toute la fiche catalogue est recopiée dans votre stock. Elle vous appartient
                ensuite : vous pouvez modifier chaque champ, prix et TVA compris, depuis la fiche
                produit.
              </p>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="fournisseur">Fournisseur</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger id="fournisseur" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SUPPLIER}>— Aucun pour l&apos;instant —</SelectItem>
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Field id="quantite" label="Quantité initiale" value={quantite} onChange={setQuantite} numeric />
              <Field id="seuil" label="Seuil d'alerte" value={seuil} onChange={setSeuil} numeric />
              <Field
                id="prixAchat"
                label="Prix d'achat"
                hint="Ce que vous payez réellement — sert au calcul de marge"
                value={prixAchat}
                onChange={setPrixAchat}
                numeric
              />
              <Field
                id="reference"
                label="Référence interne"
                value={reference}
                onChange={setReference}
              />
              <Field
                id="localisation"
                label="Emplacement"
                hint="Rayon, tiroir, réserve..."
                value={localisation}
                onChange={setLocalisation}
              />
            </CardContent>
          </Card>

          {submitError && (
            <Alert variant="destructive">
              <AlertDescription className="space-y-sp-sm">
                <p>{submitError}</p>
                {existingId && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/dashboard/stock/produits/${existingId}`}>
                      Ouvrir la fiche existante
                    </Link>
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setSelected(null)}>
              Retour à la recherche
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Ajout..." : "Ajouter au stock"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------- Étape 1
  const term = debounced.trim();
  const noResults = results !== null && results.length === 0 && term.length >= 2;

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Ajouter un produit"
        subtitle="Cherchez-le dans le catalogue national"
        icon={<PackagePlus />}
        backHref={STOCK_PATH}
        backLabel="Stock"
      />

      <div className="mx-auto w-full max-w-2xl space-y-sp-lg">
        <div className="relative">
          <Search
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nom, code-barres ou DCI..."
            aria-label="Rechercher dans le catalogue"
            className="h-11 pl-9"
          />
          {searching && (
            <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        {searchError && (
          <Alert variant="destructive">
            <AlertDescription className="space-y-sp-sm">
              <p>{searchError}</p>
              <Button asChild size="sm" variant="outline">
                <Link href={MANUAL_PATH}>
                  <PencilLine /> Saisie manuelle
                </Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {term.length < 2 && !searchError && (
          <p className="text-sm text-muted-foreground">
            Tapez au moins deux caractères. Le catalogue est partagé par toutes les pharmacies :
            les informations réglementaires sont déjà remplies.
          </p>
        )}

        {results && results.length > 0 && (
          <ul className="space-y-sp-sm">
            {results.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onClick={() => !hit.dejaEnStock && setSelected(hit)}
                  disabled={hit.dejaEnStock}
                  className={cn(
                    "flex w-full items-center gap-sp-md rounded-xl bg-card p-sp-md text-left shadow-card transition-colors",
                    hit.dejaEnStock
                      ? "cursor-default opacity-70"
                      : "hover:bg-muted/50 focus-visible:bg-muted/50",
                  )}
                >
                  <Thumbnail url={hit.photoUrl} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{hit.nom}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {[hit.dosage, hit.formeGalenique, hit.laboratoire ?? "Laboratoire inconnu"]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {hit.dci && <p className="truncate text-xs text-muted-foreground">{hit.dci}</p>}
                  </div>
                  {hit.dejaEnStock ? (
                    <Badge variant="secondary" className="shrink-0">
                      <Check className="size-3" strokeWidth={2.5} aria-hidden />
                      Déjà en stock
                    </Badge>
                  ) : (
                    hit.ppv !== null && (
                      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                        {hit.ppv.toFixed(2)} DH
                      </span>
                    )
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {noResults && (
          <Card>
            <CardContent className="space-y-sp-md text-center">
              <div className="flex justify-center text-muted-foreground">
                <Lightbulb className="size-8" strokeWidth={1.25} aria-hidden />
              </div>
              <div className="space-y-sp-xs">
                <p className="font-medium text-foreground">
                  Aucun produit du catalogue ne correspond à « {term} »
                </p>
                <p className="text-sm text-muted-foreground">
                  Signalez-le à l&apos;équipe Akribis pour qu&apos;il soit ajouté au catalogue
                  national — toutes les pharmacies en profiteront.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-sp-sm">
                <SuggestProductDialog terme={term} />
                <Button asChild variant="outline">
                  <Link href={MANUAL_PATH}>
                    <PencilLine /> Saisir manuellement
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Thumbnail({ url }: { url: string | null }) {
  if (!url) {
    return (
      <span
        className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        aria-hidden
      >
        <ImageOff className="size-5" strokeWidth={1.5} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL
    <img src={url} alt="" loading="lazy" className="size-12 shrink-0 rounded-lg object-cover" />
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  hint,
  numeric,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  numeric?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        inputMode={numeric ? "decimal" : "text"}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
