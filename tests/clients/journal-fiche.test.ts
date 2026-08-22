import { beforeEach, describe, expect, it, vi } from "vitest";
import { TYPES_ACTION } from "@/lib/audit/event-log";

/**
 * La fiche client porte le CIN et le médecin traitant : des données
 * personnelles au sens de la loi 09-08. La CNDP demande de savoir qui y a
 * touché — et, pour ces données-là, qui les a **lues**.
 *
 * Ce n'était pas le cas avant ce module : `event_log` existait, mais rien
 * n'y écrivait en dehors du catalogue Admin. La consultation d'une fiche
 * n'y laissait aucune trace, et supposer le contraire aurait laissé le
 * trou en place.
 *
 * Le faux Prisma tient le registre en mémoire, comme
 * tests/admin/journal-catalogue.test.ts : la vraie façade s'exécute, seul
 * Postgres est remplacé. Il refuse les modifications et les suppressions
 * du journal, à l'image du déclencheur posé en base.
 */

const state = vi.hoisted(() => ({
  fiches: [] as Array<Record<string, unknown>>,
  organismes: [] as Array<Record<string, unknown>>,
  journal: [] as Array<Record<string, unknown>>,
}));

const db = vi.hoisted(() => ({}) as Record<string, unknown>);

vi.mock("@/lib/db/client", () => {
  const correspond = (fiche: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([cle, valeur]) => fiche[cle] === valeur);

  const clientApi = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      const trouvee = state.fiches.find((f) => correspond(f, where));
      // Une copie : renvoyer la référence vive ferait muter l'état
      // « avant » sous le nez du journal quand `update` écrit ensuite.
      // Le vrai Prisma matérialise un objet neuf depuis la ligne.
      return trouvee ? { ...trouvee, sales: [] } : null;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const trouvee = state.fiches.find((f) => f.id === where.id)!;
      Object.assign(trouvee, data);
      return { ...trouvee };
    },
  };

  const eventLog = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      state.journal.push({ ...data });
      return data;
    },
    update: async () => {
      throw new Error("event_log est un journal en ajout seul : UPDATE refuse.");
    },
    delete: async () => {
      throw new Error("event_log est un journal en ajout seul : DELETE refuse.");
    },
  };

  const tx = {
    client: clientApi,
    eventLog,
    organismeTiersPayant: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        state.organismes.find((o) => correspond(o, where)) ?? null,
    },
  };

  Object.assign(db, tx, {
    $transaction: async (arg: unknown) =>
      typeof arg === "function" ? (arg as (t: unknown) => unknown)(tx) : Promise.all(arg as []),
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
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => TITULAIRE }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { getClient, updateClient } = await import("@/lib/server/clients");

function fiche(surcharges: Record<string, unknown> = {}) {
  return {
    id: "cli-1",
    pharmacyId: "pharm-1",
    name: "Fatima Bennani",
    phone: "0600000000",
    email: null,
    typeClient: "OCCASIONNEL",
    cin: "AB123456",
    medecinTraitant: "Dr Alami",
    adresse: null,
    codePostal: null,
    ville: null,
    pays: "Maroc",
    numeroImmatriculation: "CNSS-778899",
    insurerId: null,
    plafondCredit: null,
    solde: 0,
    pointsFidelite: 0,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...surcharges,
  };
}

const FORMULAIRE = {
  name: "Fatima Bennani",
  phone: "0600000000",
  email: "",
  typeClient: "regulier" as const,
  cin: "AB123456",
  medecinTraitant: "Dr Alami",
  adresse: "12 rue des Consuls",
  codePostal: "10000",
  ville: "Rabat",
  pays: "Maroc",
  numeroImmatriculation: "CNSS-778899",
  insurerId: null,
  plafondCredit: "",
};

beforeEach(() => {
  state.fiches = [fiche()];
  state.organismes = [{ id: "org-1", pharmacyId: "pharm-1", nom: "CNSS" }];
  state.journal = [];
});

const derniere = () => state.journal.at(-1)!;

describe("consultation d'une fiche client", () => {
  it("laisse une entrée de type consultation", async () => {
    await getClient("cli-1");

    expect(state.journal).toHaveLength(1);
    expect(derniere().typeAction).toBe(TYPES_ACTION.clientConsultation);
    expect(derniere().typeAction).toBe("client.consultation");
    expect(derniere().entite).toBe("client");
    expect(derniere().entiteId).toBe("cli-1");
  });

  it("identifie qui a consulté, et pour quelle officine", async () => {
    await getClient("cli-1");

    expect(derniere().acteurId).toBe("user-1");
    expect(derniere().acteurEmail).toBe("titulaire@akribis.test");
    expect(derniere().acteurRole).toBe("owner");
    // Contrairement au catalogue, dont les actions sont nationales.
    expect(derniere().pharmacyId).toBe("pharm-1");
  });

  it("n'archive aucun état — une lecture ne change rien", async () => {
    await getClient("cli-1");

    expect(derniere().avant).toBeUndefined();
    expect(derniere().apres).toEqual({ nom: "Fatima Bennani" });
    // Et surtout pas le CIN : le journal se consulte, et y recopier la
    // donnée sensible à chaque lecture la répandrait au lieu de la
    // surveiller.
    expect(JSON.stringify(derniere())).not.toContain("AB123456");
  });

  it("n'écrit rien quand la fiche n'existe pas", async () => {
    // Sinon une énumération d'identifiants au hasard fabriquerait autant
    // d'entrées « consultation » que d'essais, sur des fiches jamais lues.
    expect(await getClient("inconnu")).toBeNull();
    expect(state.journal).toHaveLength(0);
  });

  it("n'écrit rien pour la fiche d'une autre officine", async () => {
    state.fiches = [fiche({ id: "cli-2", pharmacyId: "autre-pharmacie" })];
    expect(await getClient("cli-2")).toBeNull();
    expect(state.journal).toHaveLength(0);
  });
});

describe("modification d'une fiche client", () => {
  it("laisse une entrée du bon type, avec l'avant et l'après", async () => {
    await updateClient("cli-1", { ...FORMULAIRE, cin: "CD987654" });

    expect(derniere().typeAction).toBe(TYPES_ACTION.clientModifie);
    expect((derniere().avant as { cin: string }).cin).toBe("AB123456");
    expect((derniere().apres as { cin: string }).cin).toBe("CD987654");
  });

  it("couvre les champs ajoutés à la fiche, pas seulement le nom", async () => {
    // C'est le point que la demande voulait voir confirmé : la
    // journalisation porte sur la ligne entière, donc sur le médecin
    // traitant et l'affiliation comme sur le reste.
    await updateClient("cli-1", {
      ...FORMULAIRE,
      medecinTraitant: "Dr Idrissi",
      insurerId: "org-1",
      plafondCredit: "1500",
    });

    const apres = derniere().apres as Record<string, unknown>;
    expect(apres.medecinTraitant).toBe("Dr Idrissi");
    expect(apres.insurerId).toBe("org-1");
    expect(apres.plafondCredit).toBe(1500);
    expect(apres.ville).toBe("Rabat");
  });

  it("refuse un organisme qui n'est pas celui de l'officine, sans rien journaliser", async () => {
    // L'identifiant vient du navigateur : rien n'empêche d'en poster un
    // autre, et une fiche rattachée à l'organisme d'une autre pharmacie
    // se réclamerait sur son bordereau.
    await expect(
      updateClient("cli-1", { ...FORMULAIRE, insurerId: "org-d-une-autre" }),
    ).rejects.toThrow("Organisme inconnu");
    expect(state.journal).toHaveLength(0);
  });

  it("écrit la trace dans la transaction de la modification", async () => {
    // Une modification enregistrée sans sa trace serait un trou dans le
    // journal, et un journal troué ne se distingue pas d'un journal faux.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("lib/server/clients.ts", "utf8"),
    );
    const fonction = /export async function updateClient[\s\S]*?\n\}/.exec(source)![0];
    expect(fonction).toMatch(/\$transaction\(async \(tx\) => \{/);
    expect(fonction).toMatch(/await journaliser\(tx, \{/);
    expect(fonction).not.toMatch(/journaliser\(prisma/);
  });
});
