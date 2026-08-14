"use server";

/**
 * Medicine call-back reminders. Every read and write is scoped to the
 * caller's own pharmacy via requireUser().
 *
 * Deliberately no messaging integration: creating a reminder records an
 * intention to phone someone, nothing is sent.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { countDueReminders, type ReminderStatusValue } from "@/lib/clients/reminders";

function toDbStatus(value: ReminderStatusValue) {
  return value.toUpperCase() as "A_FAIRE" | "FAIT" | "ANNULE";
}

function toUiStatus(value: string): ReminderStatusValue {
  return value.toLowerCase() as ReminderStatusValue;
}

export type ReminderListItem = {
  id: string;
  clientId: string;
  clientName: string;
  clientPhone: string | null;
  productName: string | null;
  dateRappel: Date;
  note: string;
  statut: ReminderStatusValue;
};

export async function listReminders(filters?: {
  clientId?: string;
  statut?: ReminderStatusValue | "all";
}): Promise<ReminderListItem[]> {
  const user = await requireUser();

  const reminders = await prisma.clientReminder.findMany({
    where: {
      pharmacyId: user.pharmacyId,
      ...(filters?.clientId ? { clientId: filters.clientId } : {}),
      ...(filters?.statut && filters.statut !== "all"
        ? { statut: toDbStatus(filters.statut) }
        : {}),
    },
    orderBy: { dateRappel: "asc" },
    include: {
      client: { select: { name: true, phone: true } },
      product: { select: { name: true } },
    },
  });

  return reminders.map((reminder) => ({
    id: reminder.id,
    clientId: reminder.clientId,
    clientName: reminder.client.name,
    clientPhone: reminder.client.phone,
    productName: reminder.product?.name ?? null,
    dateRappel: reminder.dateRappel,
    note: reminder.note,
    statut: toUiStatus(reminder.statut),
  }));
}

/** Outstanding reminders due today or already late — drives the sidebar badge. */
export async function getDueReminderCount(): Promise<number> {
  const user = await requireUser();

  const reminders = await prisma.clientReminder.findMany({
    where: { pharmacyId: user.pharmacyId, statut: "A_FAIRE" },
    select: { dateRappel: true, statut: true },
  });

  return countDueReminders(
    reminders.map((reminder) => ({
      dateRappel: reminder.dateRappel,
      statut: toUiStatus(reminder.statut),
    })),
  );
}

export async function createReminder(input: {
  clientId: string;
  productId?: string | null;
  dateRappel: string;
  note: string;
}): Promise<{ id: string }> {
  const user = await requireUser();

  const note = input.note.trim();
  if (!note) throw new Error("La note du rappel est obligatoire.");

  const date = new Date(input.dateRappel);
  if (Number.isNaN(date.getTime())) throw new Error("Date de rappel invalide.");

  // Tenant-scoped: a client id from another pharmacy must not resolve.
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, pharmacyId: user.pharmacyId },
    select: { id: true },
  });
  if (!client) throw new Error("Client introuvable.");

  const reminder = await prisma.clientReminder.create({
    data: {
      pharmacyId: user.pharmacyId,
      clientId: client.id,
      productId: input.productId ?? null,
      dateRappel: date,
      note,
    },
    select: { id: true },
  });

  revalidatePath("/rappels");
  revalidatePath(`/dashboard/clients/${client.id}`);
  // The sidebar badge lives in the dashboard layout.
  revalidatePath("/", "layout");
  return reminder;
}

export async function updateReminderStatus(
  id: string,
  statut: ReminderStatusValue,
): Promise<void> {
  const user = await requireUser();

  const updated = await prisma.clientReminder.updateMany({
    where: { id, pharmacyId: user.pharmacyId },
    data: { statut: toDbStatus(statut) },
  });
  if (updated.count === 0) throw new Error("Rappel introuvable.");

  revalidatePath("/rappels");
  revalidatePath("/", "layout");
}
