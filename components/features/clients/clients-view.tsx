"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { listClients } from "@/lib/server/clients";
import { Button } from "@/components/ui/button";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { ClientTable } from "@/components/features/clients/client-table";
import { ClientForm } from "@/components/features/clients/client-form";

const SEARCH_DEBOUNCE_MS = 300;

export function ClientsView() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const clientsQuery = useQuery({
    queryKey: ["clients", { search }],
    queryFn: () => listClients({ search }),
  });

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Clients"
        icon={<Users />}
        actions={<Button onClick={() => setFormOpen(true)}>Ajouter un client</Button>}
      />

      <div className="space-y-sp-md">
        {clientsQuery.isError && (
          <p className="text-destructive text-sm">
            Impossible de charger les clients pour le moment.
          </p>
        )}

        <ClientTable
          clients={clientsQuery.data ?? []}
          isLoading={clientsQuery.isLoading}
          search={searchInput}
          onSearchChange={setSearchInput}
        />
      </div>

      <ClientForm open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
