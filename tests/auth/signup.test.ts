import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In-memory fakes for Prisma and the Supabase admin/server clients, so
 * `signUpOwnerAction`'s saga (create pharmacy -> create auth user -> set
 * role -> create profile row, with rollback on failure) can be exercised
 * without a real database or Supabase project. `vi.hoisted` is needed
 * because `vi.mock` factories run before the rest of the file, so the
 * shared state has to be created up front rather than closed over later.
 */
const state = vi.hoisted(() => {
  type FakePharmacy = { id: string; name: string };
  type FakeUser = { id: string; pharmacyId: string; name: string; email: string; role: string };
  type FakeAuthUser = { id: string; email: string; app_metadata: Record<string, unknown> };

  return {
    pharmacies: [] as FakePharmacy[],
    users: [] as FakeUser[],
    authUsers: [] as FakeAuthUser[],
    nextPharmacyId: 1,
    nextAuthUserId: 1,
    redirects: [] as string[],
    /** Simulates "email already registered" on Supabase's side. */
    blockedEmails: new Set<string>(),
  };
});

class RedirectSignal extends Error {
  constructor(public path: string) {
    super(`NEXT_REDIRECT:${path}`);
  }
}

vi.mock("@/lib/db/client", () => ({
  prisma: {
    pharmacy: {
      create: async ({ data }: { data: { name: string } }) => {
        const pharmacy = { id: `pharmacy-${state.nextPharmacyId++}`, name: data.name };
        state.pharmacies.push(pharmacy);
        return pharmacy;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        state.pharmacies = state.pharmacies.filter((p) => p.id !== where.id);
      },
    },
    user: {
      create: async ({
        data,
      }: {
        data: { id: string; pharmacyId: string; name: string; email: string; role: string };
      }) => {
        if (state.users.some((u) => u.email === data.email)) {
          throw new Error("Unique constraint failed on the fields: (`email`)");
        }
        state.users.push(data);
        return data;
      },
    },
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        createUser: async ({ email }: { email: string; password: string }) => {
          if (state.blockedEmails.has(email) || state.authUsers.some((u) => u.email === email)) {
            return { data: { user: null }, error: { message: "Email already registered" } };
          }
          const user = { id: `auth-user-${state.nextAuthUserId++}`, email, app_metadata: {} };
          state.authUsers.push(user);
          return { data: { user }, error: null };
        },
        updateUserById: async (id: string, updates: { app_metadata: Record<string, unknown> }) => {
          const user = state.authUsers.find((u) => u.id === id);
          if (!user) return { data: { user: null }, error: { message: "not found" } };
          user.app_metadata = { ...user.app_metadata, ...updates.app_metadata };
          return { data: { user }, error: null };
        },
        deleteUser: async (id: string) => {
          state.authUsers = state.authUsers.filter((u) => u.id !== id);
          return { data: {}, error: null };
        },
      },
    },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    state.redirects.push(path);
    // Mirrors real Next.js: redirect() throws to stop execution, so a
    // signup that redirects can't fall through to further steps.
    throw new RedirectSignal(path);
  },
}));

const { signUpOwnerAction } = await import("@/lib/auth/actions");

function formDataFor(input: { pharmacyName: string; email: string; password: string }) {
  const formData = new FormData();
  formData.set("pharmacyName", input.pharmacyName);
  formData.set("email", input.email);
  formData.set("password", input.password);
  return formData;
}

/** Runs the action and swallows the expected post-success redirect. */
async function runSignUp(input: { pharmacyName: string; email: string; password: string }) {
  try {
    return await signUpOwnerAction({}, formDataFor(input));
  } catch (err) {
    if (err instanceof RedirectSignal) return { redirectedTo: err.path };
    throw err;
  }
}

beforeEach(() => {
  state.pharmacies = [];
  state.users = [];
  state.authUsers = [];
  state.nextPharmacyId = 1;
  state.nextAuthUserId = 1;
  state.redirects = [];
  state.blockedEmails = new Set();
});

describe("signUpOwnerAction", () => {
  it("creates a linked pharmacy, Supabase auth user and users row", async () => {
    await runSignUp({
      pharmacyName: "Pharmacie du Centre",
      email: "owner@example.com",
      password: "password123",
    });

    expect(state.pharmacies).toHaveLength(1);
    expect(state.authUsers).toHaveLength(1);
    expect(state.users).toHaveLength(1);

    const [pharmacy] = state.pharmacies;
    const [authUser] = state.authUsers;
    const [profile] = state.users;

    // The three records are genuinely linked, not just independently
    // created: same id between the auth user and its profile row, same
    // pharmacy id everywhere, and the owner role set in both places.
    expect(authUser.email).toBe("owner@example.com");
    expect(authUser.app_metadata).toMatchObject({ role: "owner", pharmacy_id: pharmacy.id });
    expect(profile.id).toBe(authUser.id);
    expect(profile.pharmacyId).toBe(pharmacy.id);
    expect(profile.role).toBe("OWNER");

    expect(state.redirects).toEqual(["/dashboard"]);
  });

  it("keeps two successive signups fully isolated from each other", async () => {
    await runSignUp({
      pharmacyName: "Pharmacie A",
      email: "a@example.com",
      password: "password123",
    });
    await runSignUp({
      pharmacyName: "Pharmacie B",
      email: "b@example.com",
      password: "password123",
    });

    expect(state.pharmacies).toHaveLength(2);
    expect(state.users).toHaveLength(2);

    const [pharmacyA, pharmacyB] = state.pharmacies;
    const [userA, userB] = state.users;

    expect(pharmacyA.id).not.toBe(pharmacyB.id);
    expect(userA.pharmacyId).toBe(pharmacyA.id);
    expect(userB.pharmacyId).toBe(pharmacyB.id);
    expect(userA.pharmacyId).not.toBe(userB.pharmacyId);

    // Neither account can see the other pharmacy's id in its own claims.
    const [authUserA, authUserB] = state.authUsers;
    expect(authUserA.app_metadata.pharmacy_id).toBe(pharmacyA.id);
    expect(authUserB.app_metadata.pharmacy_id).toBe(pharmacyB.id);
  });

  it("rolls back the pharmacy when Supabase account creation fails", async () => {
    state.blockedEmails.add("taken@example.com");

    const result = await runSignUp({
      pharmacyName: "Pharmacie Orpheline",
      email: "taken@example.com",
      password: "password123",
    });

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(state.pharmacies).toHaveLength(0);
    expect(state.users).toHaveLength(0);
    expect(state.redirects).toEqual([]);
  });

  it("rejects an invalid form before creating anything", async () => {
    const result = await runSignUp({
      pharmacyName: "",
      email: "not-an-email",
      password: "short",
    });

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(state.pharmacies).toHaveLength(0);
    expect(state.authUsers).toHaveLength(0);
  });
});
