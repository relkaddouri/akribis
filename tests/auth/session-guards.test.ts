import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Les gardes de page sont la deuxième barrière derrière le middleware.
 * Un compte qu'elles refusent ne doit jamais être renvoyé vers /login
 * tout court : le middleware renvoie de /login vers l'espace du rôle, et
 * le compte reviendrait sur la page qui vient de le refuser.
 */

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
}));

class SignalRedirection extends Error {
  constructor(public chemin: string) {
    super(`NEXT_REDIRECT:${chemin}`);
  }
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
      getSession: async () => ({ data: { session: null } }),
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (chemin: string) => {
    throw new SignalRedirection(chemin);
  },
}));

const { requireAdmin, requireOwner, requireUser } = await import("@/lib/auth/session");

async function redirectionDe(garde: () => Promise<unknown>): Promise<string> {
  try {
    await garde();
  } catch (e) {
    if (e instanceof SignalRedirection) return e.chemin;
    throw e;
  }
  throw new Error("aucune redirection");
}

beforeEach(() => {
  state.user = null;
});

describe("un compte connecté sans rôle", () => {
  beforeEach(() => {
    state.user = { id: "auth-2", email: "sans-role@akribis.test", app_metadata: {} };
  });

  it.each([
    ["requireUser", () => requireUser()],
    ["requireOwner", () => requireOwner()],
    ["requireAdmin", () => requireAdmin()],
  ])("%s l'envoie vers /login?raison=sans-role", async (_nom, garde) => {
    expect(await redirectionDe(garde)).toBe("/login?raison=sans-role");
  });

  it("vaut aussi pour un rôle d'officine sans pharmacie", async () => {
    state.user = { id: "auth-3", email: "x@akribis.test", app_metadata: { role: "owner" } };
    expect(await redirectionDe(() => requireUser())).toBe("/login?raison=sans-role");
  });
});

describe("les autres cas restent inchangés", () => {
  it("un visiteur non connecté va vers /login", async () => {
    expect(await redirectionDe(() => requireUser())).toBe("/login");
    expect(await redirectionDe(() => requireAdmin())).toBe("/login");
  });

  it("un pharmacien refusé du back-office va vers /dashboard", async () => {
    state.user = {
      id: "auth-1",
      email: "a@akribis.test",
      app_metadata: { role: "assistant", pharmacy_id: "pharmacy-1" },
    };
    expect(await redirectionDe(() => requireAdmin())).toBe("/dashboard");
    expect(await redirectionDe(() => requireOwner())).toBe("/dashboard");
  });

  it("un admin Akribis refusé côté officine va vers son back-office", async () => {
    state.user = { id: "auth-4", email: "s@akribis.test", app_metadata: { role: "admin_akribis" } };
    expect(await redirectionDe(() => requireUser())).toBe("/admin/catalogue");
  });

  it("laisse passer un titulaire", async () => {
    state.user = {
      id: "auth-1",
      email: "t@akribis.test",
      app_metadata: { role: "owner", pharmacy_id: "pharmacy-1" },
    };
    await expect(requireOwner()).resolves.toMatchObject({ role: "owner" });
  });
});
