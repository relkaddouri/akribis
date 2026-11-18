"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search, UserPlus, UserRound, X } from "lucide-react";
import { addClient, listClients } from "@/lib/server/clients";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const SEARCH_DEBOUNCE_MS = 200;

import type { ClientRecord } from "@/lib/server/clients";

/**
 * Ce que la caisse retient du client, au-delà de son nom.
 *
 * Le solde et le plafond servent à l'avertissement de dépassement ;
 * l'organisme et l'immatriculation à proposer le tiers payant par défaut.
 * Recopiés au moment du choix plutôt que relus à la validation : au comptoir
 * la fiche ne bouge pas entre les deux, et une requête de plus par vente
 * n'apprendrait rien.
 */
export type SelectedClient = {
  id: string;
  name: string;
  /** Négatif = le client doit à la pharmacie. Convention lib/clients/account.ts. */
  solde: number;
  plafondCredit: number | null;
  insurerId: string | null;
  numeroImmatriculation: string | null;
} | null;

function versSelection(client: ClientRecord): SelectedClient {
  return {
    id: client.id,
    name: client.name,
    solde: client.solde,
    plafondCredit: client.plafondCredit,
    insurerId: client.insurerId,
    numeroImmatriculation: client.numeroImmatriculation,
  };
}

/**
 * Inline client selector, sitting at the top of the cart.
 *
 * Deliberately not a dialog: a modal steals focus from the scanner and
 * hides the cart mid-sale. Everything happens in place — search, pick, or
 * create — so the cashier never leaves the till flow. The current client
 * stays on screen at all times rather than being something you have to
 * open a panel to check.
 */
export function ClientPicker({
  value,
  onChange,
}: {
  value: SelectedClient;
  onChange: (client: SelectedClient) => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [search]);

  // Clicking anywhere else closes the results without touching the cart.
  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  const query = useQuery({
    queryKey: ["clients", { search: debounced }],
    queryFn: () => listClients({ search: debounced }),
    enabled: debounced.length > 0,
  });

  const addMutation = useMutation({
    mutationFn: addClient,
    onSuccess: (client) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      select(versSelection(client));
    },
  });

  function select(client: SelectedClient) {
    onChange(client);
    setSearch("");
    setDebounced("");
    setIsOpen(false);
  }

  const results = query.data ?? [];
  const typedName = search.trim();
  // Offered only when nothing matches exactly, so the cashier doesn't
  // create a duplicate of the client they just found.
  const canCreate =
    typedName.length > 0 &&
    !query.isLoading &&
    !results.some((client) => client.name.toLowerCase() === typedName.toLowerCase());

  if (value) {
    return (
      <div className="flex items-center gap-sp-sm rounded-lg bg-accent px-sp-md py-sp-sm">
        <UserRound className="size-5 shrink-0 text-primary" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{value.name}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          Changer
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Retirer le client"
          onClick={() => onChange(null)}
        >
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-sp-sm rounded-xl bg-card px-sp-md py-sp-xs shadow-soft transition-shadow focus-within:ring-2 focus-within:ring-ring">
        <Search className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              // Swallowed so it doesn't reach the POS-wide "clear cart"
              // shortcut — closing the dropdown is the expected effect here.
              event.stopPropagation();
              setIsOpen(false);
            }
          }}
          placeholder="Client de passage — rechercher par nom ou téléphone"
          aria-label="Rechercher un client"
          className="h-8 w-full min-w-0 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
        />
        {query.isFetching && (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        )}
      </div>

      {isOpen && typedName.length > 0 && (
        <ul className="absolute z-20 mt-sp-xs max-h-72 w-full overflow-auto rounded-lg bg-popover p-sp-xs shadow-card">
          {results.map((client) => (
            <li key={client.id}>
              <button
                type="button"
                onClick={() => select(versSelection(client))}
                className="flex w-full items-center justify-between gap-sp-md rounded-md px-sp-md py-sp-sm text-left transition-colors hover:bg-accent"
              >
                <span className="truncate font-medium text-foreground">{client.name}</span>
                <span className="shrink-0 text-sm text-muted-foreground">{client.phone ?? ""}</span>
              </button>
            </li>
          ))}

          {canCreate && (
            <li>
              <button
                type="button"
                disabled={addMutation.isPending}
                onClick={() => addMutation.mutate({ name: typedName, phone: "" })}
                className={cn(
                  "flex w-full items-center gap-sp-sm rounded-md px-sp-md py-sp-sm text-left font-medium text-primary transition-colors hover:bg-accent",
                  results.length > 0 && "mt-sp-xs border-t pt-sp-sm",
                )}
              >
                <UserPlus className="size-4 shrink-0" strokeWidth={1.75} />
                {addMutation.isPending
                  ? "Création..."
                  : `Créer « ${typedName} » comme nouveau client`}
              </button>
            </li>
          )}

          {results.length === 0 && !canCreate && (
            <li className="px-sp-md py-sp-sm text-sm text-muted-foreground">Recherche...</li>
          )}
        </ul>
      )}

      {addMutation.isError && (
        <p className="mt-sp-xs text-sm text-destructive">
          {(addMutation.error as Error).message}
        </p>
      )}
    </div>
  );
}
