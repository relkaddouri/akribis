"use client";

import { forwardRef, useEffect, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { listProducts, type ProductRecord } from "@/lib/offline/products";
import { Input } from "@/components/ui/input";

const SEARCH_DEBOUNCE_MS = 200;

export const ProductSearch = forwardRef<
  HTMLInputElement,
  { onSelect: (product: ProductRecord) => void }
>(function ProductSearch({ onSelect }, ref) {
  const [value, setValue] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [value]);

  const query = useQuery({
    queryKey: ["products", { search: debounced }],
    queryFn: () => listProducts({ search: debounced }),
    enabled: debounced.length > 0,
  });

  const results = query.data ?? [];

  function select(product: ProductRecord) {
    onSelect(product);
    setValue("");
    setDebounced("");
  }

  async function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const code = value.trim();
    if (!code) return;

    // Fast path for a barcode scanner: it types the code and sends Enter
    // almost instantly, so this looks up an exact barcode match right
    // away instead of waiting on the debounced list — one scan, one
    // line added, no mouse needed.
    const matches = await listProducts({ search: code });
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
      <Input
        ref={ref}
        placeholder="Scanner ou rechercher un produit (nom, code-barres, DCI)..."
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        className="h-12 text-lg"
      />
      {debounced.length > 0 && results.length > 0 && (
        <ul className="bg-popover absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border shadow-md">
          {results.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                disabled={product.quantityInStock <= 0}
                onClick={() => select(product)}
                className="hover:bg-accent flex w-full items-center justify-between px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span>
                  {product.name}
                  {product.dosage ? ` — ${product.dosage}` : ""}
                </span>
                <span className="text-muted-foreground">
                  {product.price.toFixed(2)} · stock {product.quantityInStock}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
