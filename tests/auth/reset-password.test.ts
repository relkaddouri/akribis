import { beforeEach, describe, expect, it, vi } from "vitest";
import { isResetLinkInvalid } from "@/lib/auth/password-reset";
import { setPasswordSchema } from "@/lib/validations/auth";

describe("isResetLinkInvalid", () => {
  it("flags a link as invalid when the callback reported an exchange error", () => {
    expect(isResetLinkInvalid({ error: "invalid_link", hasSession: true })).toBe(true);
  });

  it("flags a link as invalid when there's no active recovery session, even with no error flag", () => {
    expect(isResetLinkInvalid({ error: undefined, hasSession: false })).toBe(true);
  });

  it("treats a clean callback with an active session as a valid, usable link", () => {
    expect(isResetLinkInvalid({ error: undefined, hasSession: true })).toBe(false);
  });
});

describe("setPasswordSchema (reused for password reset)", () => {
  it("rejects a password shorter than 8 characters", () => {
    const result = setPasswordSchema.safeParse({ password: "short1", confirmPassword: "short1" });
    expect(result.success).toBe(false);
  });

  it("rejects mismatched password and confirmation", () => {
    const result = setPasswordSchema.safeParse({
      password: "longenough1",
      confirmPassword: "differentpass",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["confirmPassword"]);
    }
  });

  it("accepts a matching pair of at least 8 characters", () => {
    const result = setPasswordSchema.safeParse({
      password: "longenough1",
      confirmPassword: "longenough1",
    });
    expect(result.success).toBe(true);
  });
});

/**
 * `resetPasswordAction` reuses the exact same schema, so this exercises
 * the action end-to-end against a fake Supabase client: rejects bad
 * input before calling Supabase at all, signs the recovery session out
 * after a successful update (per the "don't auto-login" requirement),
 * and surfaces Supabase failures (e.g. session already expired by the
 * time of submission) as a clear error instead of crashing.
 */
const state = vi.hoisted(() => ({
  updateCalls: [] as { password: string }[],
  signOutCalls: 0,
  redirects: [] as string[],
  nextUpdateError: null as { message: string } | null,
}));

class RedirectSignal extends Error {
  constructor(public path: string) {
    super(`NEXT_REDIRECT:${path}`);
  }
}

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "app.test", "x-forwarded-proto": "https" }),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    state.redirects.push(path);
    throw new RedirectSignal(path);
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      updateUser: async ({ password }: { password: string }) => {
        state.updateCalls.push({ password });
        return { data: {}, error: state.nextUpdateError };
      },
      signOut: async () => {
        state.signOutCalls += 1;
        return { error: null };
      },
    },
  }),
}));

const { resetPasswordAction } = await import("@/lib/auth/actions");

function formDataFor(password: string, confirmPassword: string) {
  const formData = new FormData();
  formData.set("password", password);
  formData.set("confirmPassword", confirmPassword);
  return formData;
}

async function runReset(password: string, confirmPassword: string) {
  try {
    return await resetPasswordAction({}, formDataFor(password, confirmPassword));
  } catch (err) {
    if (err instanceof RedirectSignal) return { redirectedTo: err.path };
    throw err;
  }
}

beforeEach(() => {
  state.updateCalls = [];
  state.signOutCalls = 0;
  state.redirects = [];
  state.nextUpdateError = null;
});

describe("resetPasswordAction", () => {
  it("rejects a short password without calling Supabase", async () => {
    const result = await runReset("short1", "short1");

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(state.updateCalls).toHaveLength(0);
  });

  it("rejects mismatched passwords without calling Supabase", async () => {
    const result = await runReset("longenough1", "somethingelse1");

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(state.updateCalls).toHaveLength(0);
  });

  it("updates the password, signs the recovery session out, then redirects to login with a success flag", async () => {
    const result = await runReset("newpassword1", "newpassword1");

    expect(state.updateCalls).toEqual([{ password: "newpassword1" }]);
    expect(state.signOutCalls).toBe(1);
    expect(result).toEqual({ redirectedTo: "/login?reset=success" });
  });

  it("shows a clear error instead of crashing when the recovery session has expired by submit time", async () => {
    state.nextUpdateError = { message: "Auth session missing" };

    const result = await runReset("newpassword1", "newpassword1");

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(state.signOutCalls).toBe(0);
    expect(state.redirects).toEqual([]);
  });
});
