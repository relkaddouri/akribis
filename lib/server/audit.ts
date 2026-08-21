"use server";

/**
 * Lecture du journal d'audit `event_log`, pour l'espace Admin.
 *
 * En lecture seule, et cela n'a pas vocation à changer : le journal est en
 * ajout seul, garanti par un déclencheur en base. Aucune fonction d'écriture
 * ni de purge ne doit apparaître ici — la journalisation passe par
 * lib/audit/event-log.ts, appelée depuis l'action qu'elle décrit.
 */

import { prisma } from "@/lib/db/client";
import { requireAdmin } from "@/lib/auth/session";
import { ENTITES } from "@/lib/audit/event-log";

export type EventLogRecord = {
  id: string;
  acteurEmail: string;
  acteurRole: string;
  typeAction: string;
  entite: string;
  entiteId: string;
  /** Le nom de la fiche visée, `null` si on ne peut plus le retrouver. */
  cible: string | null;
  avant: unknown;
  apres: unknown;
  createdAt: Date;
};

/** Combien d'entrées la page charge. Au-delà, il faudra filtrer côté base. */
const PLAFOND = 500;

function nomDansInstantane(valeur: unknown): string | null {
  if (valeur === null || typeof valeur !== "object") return null;
  const nom = (valeur as Record<string, unknown>).nom;
  return typeof nom === "string" && nom.trim() !== "" ? nom : null;
}

export async function listEventLog(): Promise<EventLogRecord[]> {
  // Troisième couche de contrôle, après le middleware et le layout : une
  // action serveur est joignable en POST sans traverser aucun des deux.
  await requireAdmin();

  const entrees = await prisma.eventLog.findMany({
    orderBy: { createdAt: "desc" },
    take: PLAFOND,
  });

  /**
   * Le nom de la cible vient d'abord de l'instantané — c'est celui qu'avait
   * la fiche au moment de l'action, et donc le seul honnête. Une bascule de
   * drapeau n'archive que le drapeau ; pour celles-là seulement, on va lire
   * le nom actuel, en une requête pour toutes.
   */
  const sansNom = entrees.filter(
    (e) =>
      e.entite === ENTITES.catalogueProduit &&
      nomDansInstantane(e.apres) === null &&
      nomDansInstantane(e.avant) === null,
  );

  const noms = new Map<string, string>();
  if (sansNom.length > 0) {
    const fiches = await prisma.catalogueProduit.findMany({
      where: { id: { in: [...new Set(sansNom.map((e) => e.entiteId))] } },
      select: { id: true, nom: true },
    });
    for (const fiche of fiches) noms.set(fiche.id, fiche.nom);
  }

  return entrees.map((e) => ({
    id: e.id,
    acteurEmail: e.acteurEmail,
    acteurRole: e.acteurRole,
    typeAction: e.typeAction,
    entite: e.entite,
    entiteId: e.entiteId,
    cible:
      nomDansInstantane(e.apres) ?? nomDansInstantane(e.avant) ?? noms.get(e.entiteId) ?? null,
    avant: e.avant,
    apres: e.apres,
    createdAt: e.createdAt,
  }));
}
