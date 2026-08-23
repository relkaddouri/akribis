"use server";

/**
 * Lecture du journal d'audit `event_log`.
 *
 * Deux publics, deux portées, et la distinction est le point important :
 * l'Admin Akribis lit tout le journal, le titulaire ne lit que ce qui
 * concerne son officine. Un titulaire qui verrait les entrées d'une autre
 * pharmacie serait une fuite, pas une commodité.
 *
 * En lecture seule, et cela n'a pas vocation à changer : le journal est en
 * ajout seul, garanti par un déclencheur en base. Aucune fonction de
 * modification ni de purge ne doit apparaître ici — la journalisation passe
 * par lib/audit/event-log.ts, appelée depuis l'action qu'elle décrit.
 *
 * Seule exception à la lecture seule : `exporterJournalCsv` écrit une
 * entrée. Elle en écrit une **de plus**, elle n'en touche aucune — sortir
 * des données personnelles est précisément ce qu'un contrôle veut voir
 * tracé.
 */

import { prisma } from "@/lib/db/client";
import { requireAdmin, requireOwner } from "@/lib/auth/session";
import { ENTITES, journaliser, libelleAction, TYPES_ACTION } from "@/lib/audit/event-log";

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

// ── Côté officine ───────────────────────────────────────────────────────

export type FiltresJournal = {
  /** E-mail de l'acteur. Vide = tous. */
  acteur?: string;
  /** `type_action` exact. Vide = tous. */
  typeAction?: string;
  /** Bornes de période, en AAAA-MM-JJ. Vides = pas de borne. */
  debut?: string;
  fin?: string;
};

/**
 * Le journal de l'officine, filtré en base.
 *
 * Filtré en base et non après coup : le plafond de 500 entrées
 * s'appliquerait sinon **avant** le filtre, et une recherche sur mars
 * ne trouverait rien parce que les 500 dernières entrées datent d'avril.
 */
function conditions(user: { pharmacyId: string }, filtres: FiltresJournal) {
  const debut = filtres.debut ? new Date(`${filtres.debut}T00:00:00.000`) : undefined;
  const fin = filtres.fin ? new Date(`${filtres.fin}T23:59:59.999`) : undefined;

  return {
    pharmacyId: user.pharmacyId,
    ...(filtres.acteur ? { acteurEmail: filtres.acteur } : {}),
    ...(filtres.typeAction ? { typeAction: filtres.typeAction } : {}),
    ...(debut || fin ? { createdAt: { ...(debut ? { gte: debut } : {}), ...(fin ? { lte: fin } : {}) } } : {}),
  };
}

async function lireJournalOfficine(
  user: { pharmacyId: string },
  filtres: FiltresJournal,
): Promise<EventLogRecord[]> {
  const entrees = await prisma.eventLog.findMany({
    where: conditions(user, filtres),
    orderBy: { createdAt: "desc" },
    take: PLAFOND,
  });

  // Le nom de la fiche vient de l'instantané — c'est celui qu'elle avait
  // au moment de l'action, et donc le seul honnête. Une consultation
  // n'archive que le nom, ce qui suffit.
  return entrees.map((e) => ({
    id: e.id,
    acteurEmail: e.acteurEmail,
    acteurRole: e.acteurRole,
    typeAction: e.typeAction,
    entite: e.entite,
    entiteId: e.entiteId,
    cible: nomDansInstantane(e.apres) ?? nomDansInstantane(e.avant),
    avant: e.avant,
    apres: e.apres,
    createdAt: e.createdAt,
  }));
}

export async function listEventLogPharmacie(
  filtres: FiltresJournal = {},
): Promise<EventLogRecord[]> {
  // Le journal expose qui a consulté quelle fiche client : c'est une
  // donnée de surveillance du personnel autant qu'un registre CNDP, et
  // elle ne regarde que le titulaire.
  const owner = await requireOwner();
  return lireJournalOfficine(owner, filtres);
}

/** Les valeurs présentes dans le journal, pour ne proposer que des filtres qui trouvent. */
export async function optionsJournal(): Promise<{ acteurs: string[]; actions: string[] }> {
  const owner = await requireOwner();
  const entrees = await prisma.eventLog.findMany({
    where: { pharmacyId: owner.pharmacyId },
    select: { acteurEmail: true, typeAction: true },
    distinct: ["acteurEmail", "typeAction"],
  });

  return {
    acteurs: [...new Set(entrees.map((e) => e.acteurEmail))].sort(),
    actions: [...new Set(entrees.map((e) => e.typeAction))].sort(),
  };
}

/** Échappement CSV : guillemets doublés, champ encadré dès qu'il contient un séparateur. */
function champCsv(valeur: string): string {
  return /[";\n\r]/.test(valeur) ? `"${valeur.replace(/"/g, '""')}"` : valeur;
}

/**
 * L'export CSV du journal filtré.
 *
 * Point-virgule et BOM UTF-8 : Excel en configuration française lit la
 * virgule comme un séparateur décimal et ouvrirait tout sur une colonne,
 * et sans BOM il rend « créée » en « crÃ©Ã©e ». Le fichier est destiné à
 * être ouvert par un pharmacien, pas par un analyste.
 */
export async function exporterJournalCsv(filtres: FiltresJournal = {}): Promise<string> {
  const owner = await requireOwner();
  const entrees = await lireJournalOfficine(owner, filtres);

  const lignes = [
    ["Date", "Utilisateur", "Rôle", "Action", "Table", "Enregistrement", "Fiche"],
    ...entrees.map((e) => [
      e.createdAt.toISOString(),
      e.acteurEmail,
      e.acteurRole,
      libelleAction(e.typeAction),
      e.entite,
      e.entiteId,
      e.cible ?? "",
    ]),
  ];

  await journaliser(prisma, {
    acteur: { id: owner.id, email: owner.email, role: owner.role },
    typeAction: TYPES_ACTION.journalExporte,
    entite: ENTITES.journal,
    // Pas de ligne visée : l'export porte sur une sélection, pas sur une
    // entrée. On archive donc ce qui la définit — filtres et volume.
    entiteId: owner.pharmacyId,
    pharmacyId: owner.pharmacyId,
    apres: { filtres, entrees: entrees.length },
  });

  return `\uFEFF${lignes.map((ligne) => ligne.map(champCsv).join(";")).join("\r\n")}`;
}
