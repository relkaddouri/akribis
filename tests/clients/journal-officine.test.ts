import { beforeEach, describe, expect, it, vi } from "vitest";
import { TYPES_ACTION } from "@/lib/audit/event-log";

/**
 * Le journal côté officine : ce que le titulaire lit, et ce qu'il en sort.
 *
 * Deux points portent tout le fichier. Le premier est une question de
 * cloisonnement : le journal d'une pharmacie ne regarde pas les autres, et
 * la restriction doit vivre dans la requête, pas dans un filtre appliqué
 * après coup. Le second est un point CNDP : extraire des données
 * personnelles est justement ce qu'un contrôle veut voir tracé, donc
 * l'export s'inscrit lui-même au journal.
 */

const state = vi.hoisted(() => ({
  entrees: [] as Array<Record<string, unknown>>,
  journal: [] as Array<Record<string, unknown>>,
  dernierWhere: null as Record<string, unknown> | null,
  dernierTake: null as number | null,
}));

const db = vi.hoisted(() => ({}) as Record<string, unknown>);

vi.mock("@/lib/db/client", () => {
  const correspond = (entree: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([cle, valeur]) => {
      if (valeur === undefined) return true;
      if (cle === "createdAt" && valeur && typeof valeur === "object") {
        const bornes = valeur as { gte?: Date; lte?: Date };
        const date = entree.createdAt as Date;
        if (bornes.gte && date < bornes.gte) return false;
        if (bornes.lte && date > bornes.lte) return false;
        return true;
      }
      return entree[cle] === valeur;
    });

  Object.assign(db, {
    eventLog: {
      findMany: async ({
        where,
        take,
      }: {
        where: Record<string, unknown>;
        take?: number;
      }) => {
        state.dernierWhere = where;
        state.dernierTake = take ?? null;
        return state.entrees.filter((e) => correspond(e, where));
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.journal.push({ ...data });
        return data;
      },
    },
  });
  return { prisma: db };
});

const TITULAIRE = {
  id: "user-1",
  email: "titulaire@akribis.test",
  name: "Titulaire",
  role: "owner",
  pharmacyId: "pharm-1",
};
const refuseOwner = vi.hoisted(() => ({ actif: false }));
vi.mock("@/lib/auth/session", () => ({
  requireAdmin: async () => ({ id: "admin", email: "a@akribis.test", role: "admin_akribis" }),
  requireOwner: async () => {
    if (refuseOwner.actif) throw new Error("Réservé au titulaire");
    return TITULAIRE;
  },
  requireUser: async () => TITULAIRE,
}));

const { exporterJournalCsv, listEventLogPharmacie } = await import("@/lib/server/audit");

function entree(surcharges: Record<string, unknown> = {}) {
  return {
    id: `e-${state.entrees.length + 1}`,
    acteurId: "user-1",
    acteurEmail: "titulaire@akribis.test",
    acteurRole: "owner",
    typeAction: TYPES_ACTION.clientConsultation,
    entite: "client",
    entiteId: "cli-1",
    pharmacyId: "pharm-1",
    avant: null,
    apres: { nom: "Fatima Bennani" },
    createdAt: new Date("2026-08-17T10:00:00"),
    ...surcharges,
  };
}

beforeEach(() => {
  state.entrees = [entree()];
  state.journal = [];
  state.dernierWhere = null;
  state.dernierTake = null;
  refuseOwner.actif = false;
});

describe("cloisonnement par officine", () => {
  it("restreint la requête à la pharmacie du titulaire", async () => {
    await listEventLogPharmacie();
    expect(state.dernierWhere).toMatchObject({ pharmacyId: "pharm-1" });
  });

  it("ne rend pas les entrées d'une autre pharmacie", async () => {
    // Identifiants explicites : le compteur du gabarit se lit à partir de
    // l'état courant, ce qui rendait la numérotation attendue trompeuse.
    state.entrees = [
      entree({ id: "e-mienne", pharmacyId: "pharm-1" }),
      entree({ id: "e-autre", pharmacyId: "pharm-2" }),
    ];
    const lues = await listEventLogPharmacie();
    expect(lues.map((e) => e.id)).toEqual(["e-mienne"]);
  });

  it("refuse un utilisateur qui n'est pas titulaire", async () => {
    // Le journal dit qui a ouvert quelle fiche : c'est de la surveillance
    // du personnel autant qu'un registre, et un assistant n'a pas à y lire
    // ses propres passages ni ceux des autres.
    refuseOwner.actif = true;
    await expect(listEventLogPharmacie()).rejects.toThrow("Réservé au titulaire");
    await expect(exporterJournalCsv()).rejects.toThrow("Réservé au titulaire");
  });
});

describe("filtres", () => {
  it("filtre en base, pas après le plafond", async () => {
    /*
     * Le point qui fait la différence à l'usage. La lecture est plafonnée
     * à 500 entrées ; filtrer le résultat après coup appliquerait le
     * plafond AVANT le filtre, et une recherche sur mars ne trouverait
     * rien parce que les 500 dernières entrées datent d'avril.
     */
    await listEventLogPharmacie({
      acteur: "assistant@akribis.test",
      typeAction: "client.modifie",
      debut: "2026-03-01",
      fin: "2026-03-31",
    });

    expect(state.dernierWhere).toMatchObject({
      pharmacyId: "pharm-1",
      acteurEmail: "assistant@akribis.test",
      typeAction: "client.modifie",
    });
    const bornes = state.dernierWhere!.createdAt as { gte: Date; lte: Date };
    expect(bornes.gte.getDate()).toBe(1);
    // La borne haute couvre la journée entière : sans cela une action du
    // 31 mars à 14 h tomberait hors d'une période finissant le 31 mars.
    expect(bornes.lte.getHours()).toBe(23);
    expect(bornes.lte.getMinutes()).toBe(59);
    expect(state.dernierTake).toBe(500);
  });

  it("n'impose aucune borne quand la période est vide", async () => {
    await listEventLogPharmacie({ debut: "", fin: "" });
    expect(state.dernierWhere).not.toHaveProperty("createdAt");
    expect(state.dernierWhere).not.toHaveProperty("acteurEmail");
  });
});

describe("export CSV", () => {
  it("s'inscrit lui-même au journal, avec ce qui le définit", async () => {
    await exporterJournalCsv({ typeAction: "client.consultation" });

    expect(state.journal).toHaveLength(1);
    const trace = state.journal[0]!;
    expect(trace.typeAction).toBe(TYPES_ACTION.journalExporte);
    expect(trace.typeAction).toBe("journal.exporte");
    expect(trace.acteurEmail).toBe("titulaire@akribis.test");
    expect(trace.pharmacyId).toBe("pharm-1");
    // L'export porte sur une sélection, pas sur une ligne : on archive
    // donc les filtres et le volume sorti.
    expect(trace.apres).toMatchObject({
      filtres: { typeAction: "client.consultation" },
      entrees: 1,
    });
  });

  it("n'écrit qu'une entrée de plus, et n'en touche aucune", async () => {
    // Le journal est en ajout seul ; l'export est la seule fonction du
    // module qui écrive, et elle ne doit rien faire d'autre qu'ajouter.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("lib/server/audit.ts", "utf8"),
    );
    expect(source).not.toMatch(/eventLog\.(update|delete|deleteMany|upsert)/);
  });

  it("rend un CSV qu'Excel en français ouvre correctement", async () => {
    const csv = await exporterJournalCsv();

    // BOM UTF-8, sans quoi « créée » s'affiche « crÃ©Ã©e ».
    expect(csv.startsWith("﻿")).toBe(true);
    // Point-virgule : la virgule est le séparateur décimal en français, et
    // Excel ouvrirait tout le fichier sur une seule colonne.
    const lignes = csv.replace(/^﻿/, "").split("\r\n");
    expect(lignes[0]).toBe("Date;Utilisateur;Rôle;Action;Table;Enregistrement;Fiche");
    expect(lignes[1]).toContain("titulaire@akribis.test");
    expect(lignes[1]).toContain("Fiche client consultée");
    expect(lignes[1]).toContain("Fatima Bennani");
  });

  it("échappe un champ contenant le séparateur", async () => {
    // Sans échappement, un nom contenant un point-virgule décalerait
    // toutes les colonnes suivantes de cette ligne.
    state.entrees = [entree({ apres: { nom: 'Bennani; "Fatima"' } })];
    const csv = await exporterJournalCsv();
    const ligne = csv.split("\r\n")[1]!;

    expect(ligne).toContain('"Bennani; ""Fatima"""');
    expect(ligne.split(";")).not.toHaveLength(7);
  });

  it("exporte ce que les filtres ont sélectionné, pas tout", async () => {
    state.entrees = [entree(), entree({ id: "e-2", typeAction: "client.modifie" })];
    const csv = await exporterJournalCsv({ typeAction: "client.modifie" });
    const lignes = csv.replace(/^﻿/, "").split("\r\n");

    expect(lignes).toHaveLength(2); // en-tête + une entrée
    expect(lignes[1]).toContain("Fiche client modifiée");
  });
});
