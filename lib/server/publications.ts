"use server";

/**
 * Prisma-backed facade for the Akribis actualités feed.
 *
 * Publications are global editorial content authored by the Akribis team,
 * so unlike every other facade here nothing is scoped by pharmacyId —
 * only read-state is per user. This module is deliberately read-only plus
 * "mark as read": creating publications is an admin_akribis concern and
 * has no entry point in this app.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import type {
  NiveauUrgenceValue,
  OutilAkribisValue,
  PublicationItem,
  PublicationTypeValue,
} from "@/lib/news/publications";

/** Prisma enum members are UPPERCASE; the UI and DB values are lowercase. */
function toLower<T extends string>(value: string): T {
  return value.toLowerCase() as T;
}

/**
 * Every publication, newest first, each flagged with whether the current
 * user has already read it. The feed is small editorial content, so it's
 * fetched whole and filtered client-side — tab switching stays instant
 * and needs no refetch.
 */
export async function listPublications(): Promise<PublicationItem[]> {
  const user = await requireUser();

  const publications = await prisma.publication.findMany({
    orderBy: { datePublication: "desc" },
    include: {
      // Scoped to this user, so `lectures` is either empty (unread) or a
      // single row (read) — the unique (user, publication) index
      // guarantees it can never be more.
      lectures: { where: { userId: user.id }, select: { id: true } },
    },
  });

  return publications.map((publication) => ({
    id: publication.id,
    titre: publication.titre,
    contenu: publication.contenu,
    type: toLower<PublicationTypeValue>(publication.type),
    niveauUrgence: publication.niveauUrgence
      ? toLower<NiveauUrgenceValue>(publication.niveauUrgence)
      : null,
    outilAssocie: publication.outilAssocie
      ? toLower<OutilAkribisValue>(publication.outilAssocie)
      : null,
    imageUrl: publication.imageUrl,
    datePublication: publication.datePublication,
    auteur: publication.auteur,
    lu: publication.lectures.length > 0,
  }));
}

/** Unread count for the signed-in user — drives the sidebar badge. */
export async function getUnreadPublicationCount(): Promise<number> {
  const user = await requireUser();

  return prisma.publication.count({
    where: { lectures: { none: { userId: user.id } } },
  });
}

/**
 * Records that the user has seen these publications. Called as cards
 * scroll into view, so it must tolerate being handed ids that are already
 * read (and concurrent calls for the same id): `skipDuplicates` makes the
 * write idempotent against the unique (user, publication) index instead
 * of throwing.
 */
export async function markPublicationsRead(publicationIds: string[]): Promise<void> {
  if (publicationIds.length === 0) return;
  const user = await requireUser();

  await prisma.publicationLecture.createMany({
    data: publicationIds.map((publicationId) => ({ userId: user.id, publicationId })),
    skipDuplicates: true,
  });

  // The sidebar badge is rendered by the dashboard layout, so the whole
  // dashboard subtree needs to re-read the count.
  revalidatePath("/", "layout");
}
