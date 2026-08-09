"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addClient, listClients } from "@/lib/server/clients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SEARCH_DEBOUNCE_MS = 200;

export type SelectedClient = { id: string; name: string } | null;

/**
 * Optional, collapsed by default: the default POS flow (walk-in sale,
 * no client) must stay exactly as fast as before this existed. Expanding
 * it reveals a search over existing clients or a two-field quick-add
 * that selects the new client immediately.
 */
export function ClientPicker({
  value,
  onChange,
}: {
  value: SelectedClient;
  onChange: (client: SelectedClient) => void;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [search]);

  const query = useQuery({
    queryKey: ["clients", { search: debounced }],
    queryFn: () => listClients({ search: debounced }),
    enabled: expanded && debounced.length > 0,
  });

  const addMutation = useMutation({
    mutationFn: addClient,
    onSuccess: (client) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      select({ id: client.id, name: client.name });
    },
  });

  function select(client: SelectedClient) {
    onChange(client);
    setExpanded(false);
    setShowNewForm(false);
    setSearch("");
  }

  function handleNewClientSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    addMutation.mutate({
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
    });
  }

  if (!expanded) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          {value ? `Client : ${value.name}` : "Vente sans client"}
        </span>
        {value ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            Retirer
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Associer un client
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      {showNewForm ? (
        <form onSubmit={handleNewClientSubmit} className="flex items-end gap-2">
          <div className="space-y-1">
            <label className="text-xs" htmlFor="new-client-name">
              Nom
            </label>
            <Input id="new-client-name" name="name" required className="h-8" />
          </div>
          <div className="space-y-1">
            <label className="text-xs" htmlFor="new-client-phone">
              Téléphone
            </label>
            <Input id="new-client-phone" name="phone" type="tel" className="h-8" />
          </div>
          <Button type="submit" size="sm" disabled={addMutation.isPending}>
            {addMutation.isPending ? "Ajout..." : "Créer"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewForm(false)}>
            Annuler
          </Button>
        </form>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              placeholder="Rechercher un client..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-8"
            />
            <Button type="button" variant="outline" size="sm" onClick={() => setShowNewForm(true)}>
              + Nouveau client
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>
              Annuler
            </Button>
          </div>
          {debounced.length > 0 && (
            <ul className="max-h-48 overflow-auto text-sm">
              {(query.data ?? []).length === 0 && !query.isLoading ? (
                <li className="text-muted-foreground px-1 py-1">Aucun client trouvé.</li>
              ) : (
                (query.data ?? []).map((client) => (
                  <li key={client.id}>
                    <button
                      type="button"
                      onClick={() => select({ id: client.id, name: client.name })}
                      className="hover:bg-accent flex w-full justify-between rounded px-1 py-1 text-left"
                    >
                      <span>{client.name}</span>
                      <span className="text-muted-foreground">{client.phone ?? ""}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
