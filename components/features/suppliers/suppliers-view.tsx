"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Truck } from "lucide-react";
import type { SupplierModel } from "@/lib/db/generated/models";
import { listSuppliers } from "@/lib/server/suppliers";
import { Button } from "@/components/ui/button";
import { AvatarBadge } from "@/components/ui/avatar-badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { SupplierForm } from "@/components/features/suppliers/supplier-form";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";

const columns: DataTableColumn<SupplierModel>[] = [
  {
    id: "name",
    header: "Nom",
    sortValue: (s) => s.name.toLowerCase(),
    cell: (s) => (
      <div className="flex items-center gap-3">
        <AvatarBadge name={s.name} />
        <span className="font-medium text-foreground">{s.name}</span>
      </div>
    ),
  },
  {
    id: "phone",
    header: "Téléphone",
    sortValue: (s) => s.phone ?? "",
    cell: (s) => s.phone ?? "—",
  },
  {
    id: "email",
    header: "E-mail",
    sortValue: (s) => s.email ?? "",
    cell: (s) => s.email ?? "—",
  },
];

export function SuppliersView() {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);

  const suppliersQuery = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => listSuppliers(),
  });

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader
        title="Fournisseurs"
        icon={<Truck />}
        backHref="/commandes"
        backLabel="Commandes"
        actions={<Button onClick={() => setFormOpen(true)}>Ajouter un fournisseur</Button>}
      />

      <DataTable
        columns={columns}
        data={suppliersQuery.data ?? []}
        getRowId={(s) => s.id}
        isLoading={suppliersQuery.isLoading}
        searchPlaceholder="Rechercher par nom, téléphone ou e-mail..."
        searchFields={(s) => [s.name, s.phone, s.email]}
        selectable={false}
        onRowClick={(s) => router.push(`/fournisseurs/${s.id}`)}
        emptyTitle="Aucun fournisseur"
        emptyDescription="Ajoutez votre premier fournisseur pour commencer."
      />

      <SupplierForm open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
