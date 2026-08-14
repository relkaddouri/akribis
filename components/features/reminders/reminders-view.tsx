"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, Phone } from "lucide-react";
import { listReminders, updateReminderStatus, type ReminderListItem } from "@/lib/server/reminders";
import {
  getReminderUrgency,
  REMINDER_STATUS_LABELS,
  REMINDER_STATUSES,
  sortReminders,
  type ReminderUrgency,
} from "@/lib/clients/reminders";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn, type DataTableFilter } from "@/components/ui/data-table";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";

const URGENCY_STYLES: Record<ReminderUrgency, string> = {
  overdue: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  today: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  upcoming: "bg-muted text-muted-foreground",
  done: "bg-muted text-muted-foreground",
};

const URGENCY_LABELS: Record<ReminderUrgency, string> = {
  overdue: "En retard",
  today: "Aujourd'hui",
  upcoming: "À venir",
  done: "Traité",
};

function UrgencyBadge({ reminder }: { reminder: ReminderListItem }) {
  const urgency = getReminderUrgency(reminder);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-4xl px-sp-sm py-sp-xs text-xs font-medium whitespace-nowrap",
        URGENCY_STYLES[urgency],
      )}
    >
      {URGENCY_LABELS[urgency]}
    </span>
  );
}

export function RemindersView() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const remindersQuery = useQuery({
    queryKey: ["reminders"],
    queryFn: () => listReminders(),
  });

  const markDone = useMutation({
    mutationFn: (id: string) => updateReminderStatus(id, "fait"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reminders"] });
      // The sidebar badge is rendered by the layout, so it needs a refresh
      // of the server tree, not just the query cache.
      router.refresh();
    },
  });

  const columns: DataTableColumn<ReminderListItem>[] = [
    {
      id: "urgency",
      header: "Échéance",
      sortValue: (reminder) => reminder.dateRappel.getTime(),
      cell: (reminder) => (
        <div className="flex items-center gap-sp-sm">
          <UrgencyBadge reminder={reminder} />
          <span className="whitespace-nowrap text-muted-foreground">
            {reminder.dateRappel.toLocaleDateString("fr-FR")}
          </span>
        </div>
      ),
    },
    {
      id: "client",
      header: "Client",
      sortValue: (reminder) => reminder.clientName.toLowerCase(),
      cell: (reminder) => (
        <span className="font-medium text-foreground">{reminder.clientName}</span>
      ),
    },
    {
      id: "phone",
      header: "Téléphone",
      cell: (reminder) =>
        reminder.clientPhone ? (
          <a
            href={`tel:${reminder.clientPhone}`}
            onClick={(event) => event.stopPropagation()}
            className="flex items-center gap-sp-xs text-primary hover:underline"
          >
            <Phone className="size-3.5" strokeWidth={1.75} />
            {reminder.clientPhone}
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "note",
      header: "Note",
      cell: (reminder) => (
        <span className="text-muted-foreground">
          {reminder.note}
          {reminder.productName ? ` · ${reminder.productName}` : ""}
        </span>
      ),
    },
    {
      id: "statut",
      header: "Statut",
      sortValue: (reminder) => reminder.statut,
      cell: (reminder) => (
        <Badge variant={reminder.statut === "a_faire" ? "default" : "secondary"}>
          {REMINDER_STATUS_LABELS[reminder.statut]}
        </Badge>
      ),
    },
  ];

  const filters: DataTableFilter<ReminderListItem>[] = [
    {
      id: "statut",
      label: "Statut",
      options: REMINDER_STATUSES.map((statut) => ({
        label: REMINDER_STATUS_LABELS[statut],
        value: statut,
      })),
      predicate: (reminder, value) => reminder.statut === value,
    },
  ];

  // Overdue first, then today, then upcoming — a call queue, not a log.
  const rows = sortReminders(remindersQuery.data ?? []);

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader title="Rappels" icon={<BellRing />} />

      {remindersQuery.isError && (
        <p className="text-destructive text-sm">Impossible de charger les rappels.</p>
      )}

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(reminder) => reminder.id}
        isLoading={remindersQuery.isLoading}
        filters={filters}
        selectable={false}
        onRowClick={(reminder) => router.push(`/dashboard/clients/${reminder.clientId}`)}
        emptyTitle="Aucun rappel"
        emptyDescription="Programmez un rappel depuis une fiche client ou une vente."
        rowActions={(reminder) =>
          reminder.statut === "a_faire" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={markDone.isPending}
              onClick={(event) => {
                event.stopPropagation();
                markDone.mutate(reminder.id);
              }}
            >
              <Check className="size-4" />
              Fait
            </Button>
          ) : null
        }
      />
    </div>
  );
}
