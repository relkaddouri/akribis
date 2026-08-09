"use client";

import Link from "next/link";
import type { ClientModel } from "@/lib/db/generated/models";
import { AvatarBadge } from "@/components/ui/avatar-badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Eye } from "lucide-react";

const columns: DataTableColumn<ClientModel>[] = [
  {
    id: "name",
    header: "Nom",
    sortValue: (c) => c.name.toLowerCase(),
    cell: (c) => (
      <div className="flex items-center gap-3">
        <AvatarBadge name={c.name} />
        <Link href={`/dashboard/clients/${c.id}`} className="font-medium text-foreground hover:underline">
          {c.name}
        </Link>
      </div>
    ),
  },
  {
    id: "phone",
    header: "Téléphone",
    sortValue: (c) => c.phone ?? "",
    cell: (c) => c.phone ?? "—",
  },
];

export function ClientTable({
  clients,
  isLoading,
  search,
  onSearchChange,
}: {
  clients: ClientModel[];
  isLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  return (
    <DataTable
      columns={columns}
      data={clients}
      getRowId={(c) => c.id}
      isLoading={isLoading}
      searchPlaceholder="Rechercher par nom ou téléphone..."
      searchValue={search}
      onSearchChange={onSearchChange}
      emptyTitle="Aucun client"
      emptyDescription="Ajoutez votre premier client pour commencer."
      rowActions={(c) => (
        <Link
          href={`/dashboard/clients/${c.id}`}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Voir le client"
        >
          <Eye className="size-4" />
        </Link>
      )}
    />
  );
}
