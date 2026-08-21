import { beforeEach, describe, expect, it, vi } from "vitest";
import { TYPES_ACTION, serialisable } from "@/lib/audit/event-log";
import { typeActionDuDrapeau } from "@/lib/catalogue/flags";

/**
 * Chaque action Admin sur le catalogue doit laisser une entrée dans
 * `event_log` : qui, quoi, sur quelle fiche, et l'état avant/après.
 *
 * Le faux Prisma tient le registre en mémoire, comme
 * tests/clients/account.test.ts : la vraie façade s'exécute, seul
 * Postgres est remplacé. Il refuse aussi les modifications et les
 * suppressions du journal, à l'image du déclencheur posé en base — sans
 * quoi le test ne dirait rien de l'inviolabilité qu'on prétend garantir.
 */

const state = vi.hoisted(() => ({
  fiches: [] as Array<Record<string, unknown>>,
  journal: [] as Array<Record<string, unknown>>,
  photosSupprimees: 0,
}));

class FauxDecimal {
  constructor(private readonly v: number) {}
  toFixed() {
    return this.v.toFixed(2);
  }
  toString() {
    return String(this.v);
  }
}

const db = vi.hoisted(() => ({}) as Record<string, unknown>);

vi.mock("@/lib/db/client", () => {
  const fiche = (id: string) => state.fiches.find((f) => f.id === id);

  const tx = {
    catalogueProduit: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const champs = { ...data };
        delete champs.photos;
        const cree = { id: `fiche-${state.fiches.length + 1}`, ...champs };
        state.fiches.push(cree);
        return cree;
      },
      // Une **copie**, comme le vrai Prisma qui matérialise un objet neuf
      // depuis la ligne. Renvoyer la référence vive faisait muter l'état
      // « avant » sous le nez du journal quand `update` écrivait ensuite —
      // un artefact du faux, pas du code, mais qui aurait fait passer un
      // test pour rouge et cherché le défaut au mauvais endroit.
      findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, true> }) => {
        const trouvee = fiche(where.id);
        if (!trouvee) return null;
        if (!select) return { ...trouvee };
        return Object.fromEntries(Object.keys(select).map((k) => [k, trouvee[k]]));
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const trouvee = fiche(where.id)!;
        const champs = { ...data };
        delete champs.photos;
        Object.assign(trouvee, champs);
        return trouvee;
      },
    },
    catalogueProduitPhoto: {
      deleteMany: async () => {
        state.photosSupprimees += 1;
        return { count: 0 };
      },
    },
    eventLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.journal.push({ ...data });
        return data;
      },
      // Le déclencheur en base refuse les deux. Le faux fait pareil : un
      // test qui les laisserait passer ne prouverait rien de l'ajout seul.
      update: async () => {
        throw new Error("event_log est un journal en ajout seul : UPDATE refuse.");
      },
      delete: async () => {
        throw new Error("event_log est un journal en ajout seul : DELETE refuse.");
      },
    },
  };

  Object.assign(db, tx, {
    $transaction: async (arg: unknown) =>
      typeof arg === "function" ? (arg as (t: unknown) => unknown)(tx) : Promise.all(arg as []),
  });
  return { prisma: db };
});

const ADMIN = {
  id: "admin-1",
  email: "admin@akribis.test",
  name: "Admin Akribis",
  role: "admin_akribis",
};
vi.mock("@/lib/auth/session", () => ({ requireAdmin: async () => ADMIN }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { createCatalogueProduit, updateCatalogueProduit, setCatalogueProduitActif, setCatalogueProduitFlag } =
  await import("@/lib/server/catalogue");

const FORMULAIRE = {
  nom: "DOLIPRANE 500 mg",
  formeGalenique: "Comprimé",
  categorie: "PHARMACEUTIQUE",
  ppv: 18.5,
  photos: [],
};

beforeEach(() => {
  state.fiches = [];
  state.journal = [];
  state.photosSupprimees = 0;
});

const derniere = () => state.journal.at(-1)!;

describe("création d'une fiche", () => {
  it("laisse une entrée du bon type", async () => {
    const r = await createCatalogueProduit(FORMULAIRE as never);
    expect(r.ok).toBe(true);
    expect(state.journal).toHaveLength(1);
    expect(derniere().typeAction).toBe(TYPES_ACTION.catalogueProduitCree);
    expect(derniere().entite).toBe("catalogue_produit");
    expect(derniere().entiteId).toBe((r as { id: string }).id);
  });

  it("identifie l'administrateur qui a agi", async () => {
    await createCatalogueProduit(FORMULAIRE as never);
    expect(derniere().acteurId).toBe("admin-1");
    expect(derniere().acteurEmail).toBe("admin@akribis.test");
    expect(derniere().acteurRole).toBe("admin_akribis");
  });

  it("n'a pas d'état « avant », et garde l'état « après »", async () => {
    await createCatalogueProduit(FORMULAIRE as never);
    expect(derniere().avant).toBeUndefined();
    expect((derniere().apres as { nom: string }).nom).toBe("DOLIPRANE 500 mg");
  });

  it("ne porte aucune pharmacie — l'action est nationale", async () => {
    await createCatalogueProduit(FORMULAIRE as never);
    expect(derniere().pharmacyId).toBeNull();
  });

  it("n'écrit rien quand le formulaire est refusé", async () => {
    const r = await createCatalogueProduit({ nom: "" } as never);
    expect(r.ok).toBe(false);
    expect(state.journal).toHaveLength(0);
  });
});

describe("modification d'une fiche", () => {
  it("garde l'avant et l'après", async () => {
    const cree = await createCatalogueProduit(FORMULAIRE as never);
    const id = (cree as { id: string }).id;

    await updateCatalogueProduit(id, { ...FORMULAIRE, nom: "DOLIPRANE 1 g" } as never);

    expect(derniere().typeAction).toBe(TYPES_ACTION.catalogueProduitModifie);
    expect((derniere().avant as { nom: string }).nom).toBe("DOLIPRANE 500 mg");
    expect((derniere().apres as { nom: string }).nom).toBe("DOLIPRANE 1 g");
  });

  it("lit l'avant dans la transaction, donc avant la suppression des photos", async () => {
    const cree = await createCatalogueProduit(FORMULAIRE as never);
    await updateCatalogueProduit((cree as { id: string }).id, FORMULAIRE as never);
    // Une seule passe de suppression, et l'entrée existe malgré tout.
    expect(state.photosSupprimees).toBe(1);
    expect(state.journal).toHaveLength(2);
  });
});

describe("désactivation et réactivation", () => {
  it("distingue la désactivation d'un simple changement de drapeau", async () => {
    const cree = await createCatalogueProduit({ ...FORMULAIRE, actifCatalogue: true } as never);
    const id = (cree as { id: string }).id;

    await setCatalogueProduitActif(id, false);
    expect(derniere().typeAction).toBe(TYPES_ACTION.catalogueProduitDesactive);
    expect(derniere().apres).toEqual({ actifCatalogue: false });

    await setCatalogueProduitActif(id, true);
    expect(derniere().typeAction).toBe(TYPES_ACTION.catalogueProduitReactive);
  });

  it("journalise aussi les autres drapeaux, sous leur propre type", async () => {
    const cree = await createCatalogueProduit(FORMULAIRE as never);
    await setCatalogueProduitFlag((cree as { id: string }).id, "necessitePrescription", true);
    expect(derniere().typeAction).toBe(TYPES_ACTION.catalogueProduitDrapeau);
  });

  it("n'écrit rien pour un champ hors de la liste blanche", async () => {
    const cree = await createCatalogueProduit(FORMULAIRE as never);
    state.journal = [];
    const r = await setCatalogueProduitFlag((cree as { id: string }).id, "ppv" as never, true);
    expect(r.ok).toBe(false);
    expect(state.journal).toHaveLength(0);
  });
});

describe("le vocabulaire des types d'action", () => {
  it("donne son propre type à la désactivation, dans les deux sens", () => {
    expect(typeActionDuDrapeau("actifCatalogue", false)).toBe("catalogue.produit.desactive");
    expect(typeActionDuDrapeau("actifCatalogue", true)).toBe("catalogue.produit.reactive");
    expect(typeActionDuDrapeau("refrigerationRequise", true)).toBe(
      "catalogue.produit.drapeau_modifie",
    );
  });
});

describe("ce qui est archivé reste lisible", () => {
  it("aplatit les Decimal, qui ne sont pas du JSON", () => {
    // Un Decimal glissé tel quel dans une colonne JSONB arrive en `{}` :
    // l'entrée s'écrit, et l'état qu'on gardait pour comparer est perdu.
    const aplati = serialisable({ ppv: new FauxDecimal(18.5), nom: "X" }) as Record<string, unknown>;
    expect(aplati.ppv).toBe("18.5");
    expect(aplati.nom).toBe("X");
  });

  it("rend les dates lisibles plutôt que vides", () => {
    const aplati = serialisable({ le: new Date("2026-08-21T00:00:00.000Z") }) as Record<string, unknown>;
    expect(aplati.le).toBe("2026-08-21T00:00:00.000Z");
  });
});

describe("le journal est en ajout seul", () => {
  it("refuse la modification d'une entrée", async () => {
    const eventLog = (db as { eventLog: { update: () => Promise<unknown> } }).eventLog;
    await expect(eventLog.update()).rejects.toThrow(/ajout seul/);
  });

  it("refuse la suppression d'une entrée", async () => {
    const eventLog = (db as { eventLog: { delete: () => Promise<unknown> } }).eventLog;
    await expect(eventLog.delete()).rejects.toThrow(/ajout seul/);
  });
});
