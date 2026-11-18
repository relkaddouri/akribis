import { beforeEach, describe, expect, it, vi } from "vitest";
import { organismeSchema, pharmacyInfoSchema } from "@/lib/validations/pharmacy";

/**
 * Les organismes de tiers payant, côté serveur.
 *
 * Deux choses comptent ici. La première est l'isolation : un organisme
 * appartient à une officine, et son identifiant vient d'un formulaire —
 * il désignerait tout aussi bien celui d'une autre pharmacie si le filtre
 * `pharmacyId` sautait. La seconde est qu'on ne supprime jamais : des
 * ventes passées référencent l'organisme.
 */

const state = vi.hoisted(() => ({
  organismes: [] as Array<Record<string, unknown>>,
  suppressions: 0,
}));

/**
 * Imite `Prisma.Decimal` d'assez près pour ce qui est testé.
 *
 * Sans lui, le faux rangeait un nombre là où la base range un Decimal, et
 * retirer le `Number()` de la façade ne changeait rien — le test passait
 * en vert sur un code qui, en production, aurait fait traverser un objet
 * non sérialisable jusqu'au navigateur.
 */
class FauxDecimal {
  constructor(private readonly valeur: number) {}
  toString() {
    return String(this.valeur);
  }
  valueOf() {
    return this.valeur;
  }
}

/**
 * Prisma **ignore** les clés absentes d'un `where` ; une comparaison
 * stricte contre `undefined`, elle, ne trouve jamais rien. Le faux
 * répondait donc « introuvable » à une requête sans filtre d'officine, et
 * masquait précisément la fuite qu'on cherche à interdire.
 */
function correspond(ligne: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([cle, valeur]) => valeur === undefined || ligne[cle] === valeur);
}

vi.mock("@/lib/db/client", () => ({
  prisma: {
    organismeTiersPayant: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        state.organismes.filter((o) => correspond(o, where)),
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        state.organismes.find((o) => correspond(o, where)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const doublon = state.organismes.find(
          (o) => o.pharmacyId === data.pharmacyId && o.code === data.code,
        );
        if (doublon) throw Object.assign(new Error("unique"), { code: "P2002" });
        const cree = {
          id: `org-${state.organismes.length + 1}`,
          actif: true,
          ...data,
          tauxCouverture: new FauxDecimal(Number(data.tauxCouverture)),
        };
        state.organismes.push(cree);
        return cree;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const trouve = state.organismes.find((o) => o.id === where.id)!;
        Object.assign(trouve, data);
        return { ...trouve };
      },
      delete: async () => {
        state.suppressions += 1;
      },
      deleteMany: async () => {
        state.suppressions += 1;
      },
    },
  },
}));

const OWNER = { id: "u1", email: "owner@akribis.test", role: "owner", pharmacyId: "ph1" };
vi.mock("@/lib/auth/session", () => ({ requireOwner: async () => OWNER }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { listOrganismes, createOrganisme, updateOrganisme, setOrganismeActif } = await import(
  "@/lib/server/organismes"
);

const CNSS = { nom: "CNSS/AMO", code: "CNSS", tauxCouverture: "70", formatBordereau: "" };

beforeEach(() => {
  state.organismes = [];
  state.suppressions = 0;
});

describe("le formulaire", () => {
  it("exige un nom et un code", () => {
    expect(organismeSchema.safeParse({ ...CNSS, nom: " " }).success).toBe(false);
    expect(organismeSchema.safeParse({ ...CNSS, code: "" }).success).toBe(false);
  });

  it("refuse un taux hors des bornes d'un pourcentage", () => {
    // 150 % n'est pas une négociation avantageuse mais une faute de frappe,
    // qui fausserait chaque vente jusqu'à ce que quelqu'un s'en aperçoive.
    expect(organismeSchema.safeParse({ ...CNSS, tauxCouverture: "150" }).success).toBe(false);
    expect(organismeSchema.safeParse({ ...CNSS, tauxCouverture: "-1" }).success).toBe(false);
    expect(organismeSchema.safeParse({ ...CNSS, tauxCouverture: "100" }).success).toBe(true);
    expect(organismeSchema.safeParse({ ...CNSS, tauxCouverture: "0" }).success).toBe(true);
  });

  it("rend nul un format de bordereau laissé vide", () => {
    const parsed = organismeSchema.parse({ ...CNSS, formatBordereau: "   " });
    expect(parsed.formatBordereau).toBeNull();
  });
});

describe("création", () => {
  it("rattache l'organisme à l'officine du titulaire", async () => {
    const r = await createOrganisme(CNSS);
    expect(r.ok).toBe(true);
    expect(state.organismes[0]!.pharmacyId).toBe("ph1");
    expect(String(state.organismes[0]!.tauxCouverture)).toBe("70");
  });

  it("refuse un code déjà utilisé, en le disant", async () => {
    await createOrganisme(CNSS);
    const r = await createOrganisme({ ...CNSS, nom: "Autre nom" });
    expect(r).toEqual({
      ok: false,
      error:
        "Un organisme portant le code « CNSS » existe déjà. Ouvrez-le plutôt que d'en créer un second.",
    });
    expect(state.organismes).toHaveLength(1);
  });

  it("n'écrit rien quand le formulaire est refusé", async () => {
    const r = await createOrganisme({ ...CNSS, tauxCouverture: "150" });
    expect(r.ok).toBe(false);
    expect(state.organismes).toHaveLength(0);
  });
});

describe("l'organisme d'une autre officine reste hors de portée", () => {
  beforeEach(() => {
    state.organismes.push({
      id: "org-voisine",
      pharmacyId: "ph2",
      nom: "CNOPS",
      code: "CNOPS",
      tauxCouverture: new FauxDecimal(80),
      actif: true,
    });
  });

  it("n'apparaît pas dans la liste", async () => {
    await createOrganisme(CNSS);
    const liste = await listOrganismes();
    expect(liste.map((o) => o.code)).toEqual(["CNSS"]);
  });

  it("ne peut pas être modifié", async () => {
    const r = await updateOrganisme("org-voisine", { ...CNSS, nom: "Détourné" });
    expect(r).toEqual({ ok: false, error: "Organisme introuvable." });
    expect(state.organismes.find((o) => o.id === "org-voisine")!.nom).toBe("CNOPS");
  });

  it("ne peut pas être désactivé", async () => {
    const r = await setOrganismeActif("org-voisine", false);
    expect(r).toEqual({ ok: false, error: "Organisme introuvable." });
    expect(state.organismes.find((o) => o.id === "org-voisine")!.actif).toBe(true);
  });
});

describe("désactivation", () => {
  it("bascule le drapeau, dans les deux sens", async () => {
    const cree = await createOrganisme(CNSS);
    const id = (cree as { id: string }).id;

    await setOrganismeActif(id, false);
    expect(state.organismes.find((o) => o.id === id)!.actif).toBe(false);

    await setOrganismeActif(id, true);
    expect(state.organismes.find((o) => o.id === id)!.actif).toBe(true);
  });

  it("ne supprime jamais rien", async () => {
    const cree = await createOrganisme(CNSS);
    await setOrganismeActif((cree as { id: string }).id, false);
    expect(
      state.suppressions,
      "Des ventes passées référencent l'organisme : l'effacer fausserait la traçabilité.",
    ).toBe(0);
  });

  it("laisse l'organisme désactivé visible, pour pouvoir le rétablir", async () => {
    const cree = await createOrganisme(CNSS);
    await setOrganismeActif((cree as { id: string }).id, false);
    const liste = await listOrganismes();
    expect(liste).toHaveLength(1);
    expect(liste[0]!.actif).toBe(false);
  });
});

describe("aplatissement du Decimal", () => {
  it("rend le taux en nombre, pas en objet", async () => {
    await createOrganisme({ ...CNSS, tauxCouverture: "70.5" });
    const [organisme] = await listOrganismes();
    // Un Decimal traversant la frontière serveur/client arrive en chaîne
    // sans que rien ne le signale — « 70.5 » + 10 ferait « 70.510 ».
    expect(typeof organisme!.tauxCouverture).toBe("number");
    expect(organisme!.tauxCouverture).toBe(70.5);
  });
});

describe("le champ INPE", () => {
  it("s'ajoute aux informations de la pharmacie", () => {
    const parsed = pharmacyInfoSchema.parse({
      name: "Pharmacie du Centre",
      loyaltyRate: "1",
      inpe: " 12345678 ",
    });
    expect(parsed.inpe).toBe("12345678");
  });

  it("reste facultatif, comme l'ICE et le numéro d'ordre", () => {
    const parsed = pharmacyInfoSchema.parse({ name: "X", loyaltyRate: "1" });
    expect(parsed.inpe).toBeNull();
    expect(parsed.ice).toBeNull();
    expect(parsed.orderNumber).toBeNull();
  });
});
