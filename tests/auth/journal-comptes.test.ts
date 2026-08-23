import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La journalisation des événements de compte : connexion, déconnexion,
 * invitation d'un assistant.
 *
 * Un point de conception traverse ce fichier. Sur les actions métier, la
 * trace vit **dans la transaction** : la vente et son entrée passent ou
 * échouent ensemble. Ici, non — l'authentification passe par Supabase et
 * la trace par Prisma, il n'y a pas de transaction commune à partager. Le
 * choix est donc explicite et vérifié plus bas : **la trace cède le pas à
 * l'accès**. Refuser une connexion parce que le journal est indisponible
 * mettrait l'officine à l'arrêt pour une écriture accessoire.
 */

const state = vi.hoisted(() => ({
  journal: [] as Record<string, unknown>[],
  redirections: [] as string[],
  utilisateurConnecte: null as Record<string, unknown> | null,
  /** Simule une base de journal indisponible. */
  journalEnPanne: false,
  echecConnexion: false,
  utilisateursCrees: [] as Record<string, unknown>[],
}));

class SignalRedirection extends Error {
  constructor(public chemin: string) {
    super(`NEXT_REDIRECT:${chemin}`);
  }
}

const UTILISATEUR_SUPABASE = {
  id: "auth-1",
  email: "titulaire@akribis.test",
  app_metadata: { role: "owner", pharmacy_id: "pharmacy-1" },
};

vi.mock("@/lib/db/client", () => ({
  prisma: {
    eventLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (state.journalEnPanne) throw new Error("base indisponible");
        state.journal.push({ ...data });
        return data;
      },
    },
    user: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.utilisateursCrees.push({ ...data });
        return data;
      },
    },
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: async () =>
        state.echecConnexion
          ? { data: { user: null }, error: { message: "Invalid login credentials" } }
          : { data: { user: UTILISATEUR_SUPABASE }, error: null },
      getUser: async () => ({ data: { user: state.utilisateurConnecte } }),
      signOut: async () => {
        state.utilisateurConnecte = null;
        return { error: null };
      },
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        inviteUserByEmail: async (email: string) => ({
          data: { user: { id: "auth-invite-1", email } },
          error: null,
        }),
        updateUserById: async () => ({ data: {}, error: null }),
      },
    },
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  requireOwner: async () => ({
    id: "user-1",
    email: "titulaire@akribis.test",
    name: "Titulaire",
    role: "owner",
    pharmacyId: "pharmacy-1",
  }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "akribis.test"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (chemin: string) => {
    state.redirections.push(chemin);
    // Comme le vrai Next : `redirect()` lève, donc rien ne s'exécute
    // après lui — c'est pourquoi la trace doit être écrite avant.
    throw new SignalRedirection(chemin);
  },
}));

const { inviteAssistantAction, signInAction, signOutAction } = await import(
  "@/lib/auth/actions"
);

function champs(valeurs: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [cle, valeur] of Object.entries(valeurs)) formData.set(cle, valeur);
  return formData;
}

beforeEach(() => {
  state.journal = [];
  state.redirections = [];
  state.utilisateurConnecte = UTILISATEUR_SUPABASE;
  state.journalEnPanne = false;
  state.echecConnexion = false;
  state.utilisateursCrees = [];
});

const derniere = () => state.journal.at(-1)!;

describe("connexion", () => {
  it("écrit une entrée avant la redirection", async () => {
    // `redirect()` lève : une trace écrite après lui ne serait jamais
    // écrite, et rien ne le signalerait.
    await expect(
      signInAction({}, champs({ email: "titulaire@akribis.test", password: "motdepasse1" })),
    ).rejects.toThrow(SignalRedirection);

    expect(state.journal).toHaveLength(1);
    expect(derniere().typeAction).toBe("utilisateur.connexion");
    expect(derniere().entite).toBe("utilisateur");
    expect(derniere().acteurId).toBe("auth-1");
    expect(derniere().acteurRole).toBe("owner");
    expect(derniere().pharmacyId).toBe("pharmacy-1");
    expect(state.redirections).toHaveLength(1);
  });

  it("n'écrit rien quand les identifiants sont refusés", async () => {
    state.echecConnexion = true;

    const resultat = await signInAction(
      {},
      champs({ email: "titulaire@akribis.test", password: "mauvais123" }),
    );

    expect(resultat.error).toBe("Identifiants incorrects");
    expect(state.journal).toHaveLength(0);
  });

  it("laisse entrer même si le journal est indisponible", async () => {
    /*
     * Le compromis assumé du module. Une écriture de journal en échec ne
     * doit pas barrer l'accès à l'officine : le pharmacien a un comptoir
     * à tenir, et l'entrée manquante se voit à la relecture. C'est
     * l'inverse du choix fait sur les ventes, où la trace partage la
     * transaction et tombe avec elle.
     */
    state.journalEnPanne = true;

    await expect(
      signInAction({}, champs({ email: "titulaire@akribis.test", password: "motdepasse1" })),
    ).rejects.toThrow(SignalRedirection);

    expect(state.redirections).toHaveLength(1);
  });
});

describe("déconnexion", () => {
  it("écrit une entrée, en nommant qui part", async () => {
    await expect(signOutAction()).rejects.toThrow(SignalRedirection);

    expect(state.journal).toHaveLength(1);
    expect(derniere().typeAction).toBe("utilisateur.deconnexion");
    // Lu AVANT la déconnexion : après, la session n'existe plus et le
    // journal ne saurait plus qui vient de partir.
    expect(derniere().acteurId).toBe("auth-1");
    expect(derniere().acteurEmail).toBe("titulaire@akribis.test");
  });

  it("déconnecte quand même une session déjà expirée", async () => {
    state.utilisateurConnecte = null;

    await expect(signOutAction()).rejects.toThrow(SignalRedirection);

    expect(state.journal).toHaveLength(0);
    expect(state.redirections).toEqual(["/login"]);
  });
});

describe("invitation d'un assistant", () => {
  it("vise l'invité, pas celui qui invite", async () => {
    const resultat = await inviteAssistantAction(
      {},
      champs({ name: "Salma", email: "salma@akribis.test" }),
    );

    expect(resultat.success).toBe(true);
    expect(state.journal).toHaveLength(1);
    expect(derniere().typeAction).toBe("utilisateur.invite");
    // L'acteur est le titulaire, l'entité visée est le compte créé : le
    // journal répond ainsi à « qui a donné cet accès » comme à « qui a
    // reçu un accès ».
    expect(derniere().acteurEmail).toBe("titulaire@akribis.test");
    expect(derniere().entiteId).toBe("auth-invite-1");
    expect(derniere().apres).toMatchObject({
      nom: "Salma",
      email: "salma@akribis.test",
      role: "assistant",
    });
  });

  it("n'écrit rien quand le formulaire est refusé", async () => {
    const resultat = await inviteAssistantAction({}, champs({ name: "", email: "pas-un-email" }));

    expect(resultat.error).toBeDefined();
    expect(state.journal).toHaveLength(0);
    expect(state.utilisateursCrees).toHaveLength(0);
  });
});
