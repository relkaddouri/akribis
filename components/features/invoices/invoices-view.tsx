"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { listInvoices, type InvoiceListItem } from "@/lib/server/invoices";
import { formatMad } from "@/lib/invoices/totals";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";

const SEARCH_DEBOUNCE_MS = 300;

const columns: DataTableColumn<InvoiceListItem>[] = [
  {
    id: "number",
    header: "Numéro",
    sortValue: (invoice) => invoice.number,
    cell: (invoice) => (
      <span className="flex items-center gap-sp-sm font-medium text-foreground">
        <FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        {invoice.number}
      </span>
    ),
  },
  {
    id: "date",
    header: "Date",
    sortValue: (invoice) => invoice.issuedAt.getTime(),
    cell: (invoice) => invoice.issuedAt.toLocaleDateString("fr-FR"),
  },
  {
    id: "client",
    header: "Client",
    sortValue: (invoice) => (invoice.clientName ?? "").toLowerCase(),
    cell: (invoice) => invoice.clientName ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "total",
    header: "Total TTC",
    sortValue: (invoice) => invoice.totalTtc,
    cell: (invoice) => formatMad(invoice.totalTtc),
  },
  {
    id: "status",
    header: "Statut",
    sortValue: (invoice) => invoice.status,
    cell: (invoice) =>
      invoice.status === "cancelled" ? (
        <Badge variant="destructive">Annulée</Badge>
      ) : (
        <Badge variant="secondary">Émise</Badge>
      ),
  },
];

export function InvoicesView() {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const invoicesQuery = useQuery({
    queryKey: ["invoices", { search, from, to }],
    queryFn: () => listInvoices({ search, from: from || undefined, to: to || undefined }),
  });

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Factures"
        icon={<FileText />}
        actions={
          <Button asChild>
            <Link href="/factures/nouvelle">Nouvelle facture</Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-sp-md rounded-xl bg-card p-sp-md shadow-soft">
        <div className="min-w-56 flex-1 space-y-sp-xs">
          <Label htmlFor="invoice-search">Recherche</Label>
          <Input
            id="invoice-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Numéro ou client..."
          />
        </div>
        <div className="space-y-sp-xs">
          <Label htmlFor="invoice-from">Du</Label>
          <Input
            id="invoice-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="space-y-sp-xs">
          <Label htmlFor="invoice-to">Au</Label>
          <Input
            id="invoice-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        {(from || to || searchInput) && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearchInput("");
              setFrom("");
              setTo("");
            }}
          >
            Réinitialiser
          </Button>
        )}
      </div>

      {invoicesQuery.isError && (
        <p className="text-destructive text-sm">Impossible de charger les factures.</p>
      )}

      <DataTable
        columns={columns}
        data={invoicesQuery.data ?? []}
        getRowId={(invoice) => invoice.id}
        isLoading={invoicesQuery.isLoading}
        emptyTitle="Aucune facture"
        emptyDescription="Générez une facture à partir d'une ou plusieurs ventes."
        onRowClick={(invoice) => router.push(`/factures/${invoice.id}`)}
        rowActions={(invoice) => (
          <div className="flex items-center gap-sp-xs">
            {/* Plus d'icône « œil » : la ligne entière ouvre la facture,
                comme dans les dix autres tableaux de l'application. Garder
                les deux ferait deux cibles pour un même geste, dont une
                minuscule. Le téléchargement reste, lui : il ne navigue pas,
                et `DataTable` arrête la propagation sur cette cellule. */}
            <a
              href={`/factures/${invoice.id}/pdf`}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={`Télécharger le PDF de ${invoice.number}`}
            >
              <Download className="size-4" />
            </a>
          </div>
        )}
      />
    </div>
  );
}
