"use client";

import { forwardRef, useEffect, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { listProducts, type ProductRecord } from "@/lib/offline/products";
import { isLowStock } from "@/lib/stock/alerts";
import { cn } from "@/lib/utils";

const SEARCH_DEBOUNCE_MS = 200;

/**
 * What low stock *means* depends entirely on the screen.
 *
 * At the till ("sell") an empty shelf is a dead end: the product can't be
 * sold, so it reads red and can't be picked. On a purchase order ("purchase")
 * the very same product is the one most worth ordering, so it is always
 * selectable and reads as an invitation, not an error.
 */
export type ProductSearchContext = "sell" | "purchase";

function StockBadge({
  product,
  context,
}: {
  product: ProductRecord;
  context: ProductSearchContext;
}) {
  const outOfStock = product.quantityInStock <= 0;
  const low = isLowStock(product);

  if (context === "purchase") {
    // One amber "worth restocking" signal covers both empty and low: on this
    // screen the distinction changes nothing about what to do next.
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-sp-xs rounded-4xl px-sp-sm py-sp-xs text-xs font-semibold whitespace-nowrap",
          low
            ? "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
            : "bg-muted text-muted-foreground",
        )}
      >
        {low ? `À réapprovisionner · stock ${product.quantityInStock}` : `Stock ${product.quantityInStock}`}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-4xl px-sp-sm py-sp-xs text-xs font-semibold whitespace-nowrap",
        outOfStock && "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
        low && !outOfStock && "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
        !outOfStock && !low && "bg-muted text-muted-foreground",
      )}
    >
      {outOfStock ? "Rupture" : `Stock ${product.quantityInStock}`}
    </span>
  );
}

export const ProductSearch = forwardRef<
  HTMLInputElement,
  {
    onSelect: (product: ProductRecord) => void;
    /** Defaults to the till's rules; "purchase" never blocks a selection. */
    context?: ProductSearchContext;
    placeholder?: string;
    /**
     * With an empty query, show these as a starting point — used by the
     * purchase screen to propose what's below its alert threshold before
     * the buyer has typed anything.
     */
    suggestions?: ProductRecord[];
    suggestionsLabel?: string;
  }
>(function ProductSearch(
  { onSelect, context = "sell", placeholder, suggestions = [], suggestionsLabel },
  ref,
) {
  const [value, setValue] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [value]);

  const query = useQuery({
    // `actifsSeulement` fait partie de la clé : la liste du stock
    // interroge le même cache React Query sous ["products", { search }].
    // Sans lui, l'un des deux écrans recevrait la liste de l'autre.
    queryKey: ["products", { search: debounced, actifsSeulement: true }],
    queryFn: () => listProducts({ search: debounced, actifsSeulement: true }),
    enabled: debounced.length > 0,
  });

  // Nothing typed yet: fall back to the caller's suggestions, so the list
  // is useful before the first keystroke rather than empty.
  const isSuggesting = debounced.length === 0 && suggestions.length > 0;
  const results = isSuggesting ? suggestions : (query.data ?? []);

  function select(product: ProductRecord) {
    onSelect(product);
    setValue("");
    setDebounced("");
  }

  async function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      // Clearing the search box is what Escape should do while typing;
      // the POS-wide "empty the cart" shortcut only applies when the
      // field is already empty.
      if (value.length > 0) {
        event.stopPropagation();
        setValue("");
        setDebounced("");
      }
      return;
    }

    if (event.key !== "Enter") return;
    event.preventDefault();
    // Enter inside a non-empty search box means "add this product", not
    // "validate the sale" — stop it reaching the POS-wide shortcut.
    event.stopPropagation();
    const code = value.trim();
    if (!code) return;

    // Fast path for a barcode scanner: it types the code and sends Enter
    // almost instantly, so this looks up an exact barcode match right
    // away instead of waiting on the debounced list — one scan, one
    // line added, no mouse needed.
    // Un produit désactivé ne se vend pas, même scanné : il ne remonte
    // pas ici, et la recherche reste sans résultat comme pour un code
    // inconnu.
    const matches = await listProducts({ search: code, actifsSeulement: true });
    const exact = matches.find((product) => product.barcode === code);
    if (exact) {
      select(exact);
      return;
    }

    if (results.length === 1) {
      select(results[0]);
    }
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-sp-sm rounded-xl bg-card px-sp-md shadow-soft transition-shadow focus-within:ring-2 focus-within:ring-ring">
        <Search className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <input
          ref={ref}
          placeholder={placeholder ?? "Scanner ou rechercher un produit (nom, code-barres, DCI)..."}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Rechercher un produit"
          className="h-14 w-full min-w-0 bg-transparent text-lg text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      {results.length > 0 && (
        <ul className="absolute z-20 mt-sp-xs max-h-80 w-full overflow-auto rounded-xl bg-popover p-sp-xs shadow-card">
          {isSuggesting && suggestionsLabel && (
            <li className="px-sp-md py-sp-xs text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {suggestionsLabel}
            </li>
          )}
          {results.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                // Never blocked when buying: an empty shelf is precisely
                // what the order is meant to fix.
                disabled={context === "sell" && product.quantityInStock <= 0}
                onClick={() => select(product)}
                className="flex w-full items-center justify-between gap-sp-md rounded-lg px-sp-md py-sp-sm text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">
                    {product.name}
                    {product.dosage ? ` — ${product.dosage}` : ""}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {product.price.toFixed(2)} MAD
                  </span>
                </span>
                <StockBadge product={product} context={context} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
