import { beforeEach, describe, expect, it, vi } from "vitest";
import { hacherPin, pinValide, verifierPin } from "@/lib/caisse/pin";

/**
 * Le code PIN de clôture : qui peut arrêter la journée comptable.
 *
 * Trois règles, et la troisième est la plus facile à perdre de vue : un
 * PIN refusé ne bloque pas, mais il laisse une trace. C'est la seule
 * contrepartie à l'absence de limite de tentatives, et sans elle le
 * titulaire ne saurait jamais qu'on a essayé.
 */

const state = vi.hoisted(() => ({
  journal: [] as Record<string, unknown>[],
  sessions: [] as Record<string, unknown>[],
  pharmacy: {
    clotureAssistantAutorisee: false,
    cloturePinHash: null as string | null,
  },
  role: "owner" as "owner" | "assistant",
  compteurZ: 0,
}));

vi.mock("@/lib/db/generated/client", () => ({
  Prisma: {
    Decimal: class {
      constructor(private readonly v: number) {}
      toString() {
        return String(this.v);
      }
      toFixed(n: number) {
        return this.v.toFixed(n);
      }
    },
    PrismaClientKnownRequestError: class extends Error {
      code = "P2002";
    },
  },
}));

vi.mock("@/lib/db/client", () => {
  const tx = {
    caisseSession: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const trouvee = state.sessions.find(
          (s) => s.statut === (where.statut ?? s.statut) && s.pharmacyId === where.pharmacyId,
        );
        return trouvee ? { ...trouvee } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const s = state.sessions.find((x) => x.id === where.id)!;
        Object.assign(s, data);
        return { ...s };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const creee = { id: `sess-${state.sessions.length + 1}`, ...data };
        state.sessions.push(creee);
        return { ...creee };
      },
    },
    sale: { findMany: async () => [], count: async () => 0 },
    pharmacy: {
      findUniqueOrThrow: async () => ({ ...state.pharmacy, name: "Pharmacie", ice: null, identifiantFiscal: null }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.pharmacy, data);
        return state.pharmacy;
      },
    },
    eventLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.journal.push({ ...data });
        return data;
      },
    },
    $queryRaw: async () => [{ last_sequence: (state.compteurZ += 1) }],
  };

  return {
    prisma: {
      ...tx,
      $transaction: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
    },
  };
});

vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({
    id: state.role === "owner" ? "user-owner" : "user-assistant",
    email: `${state.role}@akribis.test`,
    name: state.role,
    role: state.role,
    pharmacyId: "pharmacy-1",
  }),
  requireOwner: async () => {
    if (state.role !== "owner") throw new Error("Réservé au titulaire");
    return {
      id: "user-owner",
      email: "owner@akribis.test",
      name: "Titulaire",
      role: "owner",
      pharmacyId: "pharmacy-1",
    };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { cloturerCaisse } = await import("@/lib/server/caisse");

beforeEach(() => {
  state.journal = [];
  state.sessions = [
    {
      id: "sess-1",
      pharmacyId: "pharmacy-1",
      statut: "OUVERTE",
      fondCaisseInitial: 200,
      dateOuverture: new Date(),
      ouvertePar: "user-owner",
    },
  ];
  state.pharmacy = { clotureAssistantAutorisee: false, cloturePinHash: null };
  state.role = "owner";
  state.compteurZ = 0;
});

describe("le code PIN lui-même", () => {
  it("n'accepte que 4 à 6 chiffres", () => {
    expect(pinValide("1234")).toBe(true);
    expect(pinValide("123456")).toBe(true);
    expect(pinValide("123")).toBe(false);
    expect(pinValide("1234567")).toBe(false);
    expect(pinValide("12a4")).toBe(false);
    expect(pinValide("")).toBe(false);
  });

  it("ne se retrouve jamais en clair dans le haché", () => {
    const hache = hacherPin("482913");
    expect(hache).not.toContain("482913");
    expect(hache.startsWith("scrypt$")).toBe(true);
  });

  it("donne deux hachés différents pour le même PIN", () => {
    // Le sel. Sans lui, deux officines ayant choisi « 1234 » auraient le
    // même haché, et une seule table de correspondance les ouvrirait
    // toutes les deux.
    expect(hacherPin("1234")).not.toBe(hacherPin("1234"));
  });

  it("reconnaît le bon PIN et refuse les autres", () => {
    const hache = hacherPin("482913");
    expect(verifierPin("482913", hache)).toBe(true);
    expect(verifierPin("482914", hache)).toBe(false);
    expect(verifierPin("", hache)).toBe(false);
  });

  it("refuse plutôt que de lever sur un haché illisible", () => {
    // Un PIN qu'on n'arrive pas à relire doit refuser la clôture, pas
    // faire tomber l'écran.
    expect(verifierPin("1234", null)).toBe(false);
    expect(verifierPin("1234", "n'importe quoi")).toBe(false);
    expect(verifierPin("1234", "scrypt$zz$zz")).toBe(false);
  });
});

describe("qui peut clôturer", () => {
  it("le titulaire, toujours, et sans PIN", async () => {
    const r = await cloturerCaisse({ especesReelles: 200 });
    expect(r.ok).toBe(true);
    expect(state.sessions[0]!.statut).toBe("CLOTUREE");
    expect(state.sessions[0]!.fermetureParPin).toBe(false);
  });

  it("le titulaire même quand le réglage assistant est actif", async () => {
    state.pharmacy = { clotureAssistantAutorisee: true, cloturePinHash: hacherPin("482913") };
    const r = await cloturerCaisse({ especesReelles: 200 });
    expect(r.ok).toBe(true);
    expect(state.sessions[0]!.fermetureParPin).toBe(false);
  });

  it("pas l'assistant quand le réglage est désactivé, même avec un PIN", async () => {
    state.role = "assistant";
    const r = await cloturerCaisse({ especesReelles: 200, pin: "482913" });

    expect(r).toEqual({ ok: false, error: "La clôture de caisse est réservée au titulaire." });
    expect(state.sessions[0]!.statut).toBe("OUVERTE");
    // Rien à journaliser : ce n'est pas une tentative de PIN, c'est un
    // rôle qui n'a pas le droit. Le refus ne dépend d'aucun secret.
    expect(state.journal).toHaveLength(0);
  });

  it("l'assistant avec le bon PIN quand le réglage est actif", async () => {
    state.role = "assistant";
    state.pharmacy = { clotureAssistantAutorisee: true, cloturePinHash: hacherPin("482913") };

    const r = await cloturerCaisse({ especesReelles: 200, pin: "482913" });

    expect(r.ok).toBe(true);
    expect(state.sessions[0]!.statut).toBe("CLOTUREE");
    expect(state.sessions[0]!.fermeePar).toBe("user-assistant");
    // Le drapeau : le titulaire doit toujours distinguer qui a vraiment
    // arrêté la caisse, et par quel moyen.
    expect(state.sessions[0]!.fermetureParPin).toBe(true);
  });

  it("refuse un PIN incorrect et le journalise", async () => {
    state.role = "assistant";
    state.pharmacy = { clotureAssistantAutorisee: true, cloturePinHash: hacherPin("482913") };

    const r = await cloturerCaisse({ especesReelles: 200, pin: "000000" });

    expect(r).toEqual({ ok: false, error: "Code PIN incorrect." });
    expect(state.sessions[0]!.statut).toBe("OUVERTE");

    expect(state.journal).toHaveLength(1);
    expect(state.journal[0]!.typeAction).toBe("caisse.pin_refuse");
    expect(state.journal[0]!.acteurEmail).toBe("assistant@akribis.test");
    // Le PIN essayé n'est PAS archivé : le journal se consulte, et y
    // recopier des tentatives de code aiderait qui les lit à deviner.
    expect(JSON.stringify(state.journal[0])).not.toContain("000000");
  });

  it("journalise aussi une tentative sans PIN du tout", async () => {
    state.role = "assistant";
    state.pharmacy = { clotureAssistantAutorisee: true, cloturePinHash: hacherPin("482913") };

    await cloturerCaisse({ especesReelles: 200 });

    expect(state.journal).toHaveLength(1);
    expect(state.journal[0]!.apres).toMatchObject({ motif: "code absent" });
  });
});

describe("le Z produit par la clôture", () => {
  it("calcule le théorique, l'écart, et attribue un numéro", async () => {
    await cloturerCaisse({ especesReelles: 180 });

    const session = state.sessions[0]!;
    // Aucune vente dans ce faux : le théorique est le fond initial seul.
    expect(Number(String(session.especesTheoriques))).toBe(200);
    expect(Number(String(session.especesReelles))).toBe(180);
    expect(Number(String(session.ecartCaisse))).toBe(-20);
    expect(session.numeroZ).toMatch(/^Z-\d{4}-\d{2}-\d{2}-001$/);
  });

  it("refuse un montant compté négatif", async () => {
    const r = await cloturerCaisse({ especesReelles: -5 });
    expect(r.ok).toBe(false);
    expect(state.sessions[0]!.statut).toBe("OUVERTE");
  });
});
