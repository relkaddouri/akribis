import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimiter, DEFAULT_MAX_ATTEMPTS } from "@/lib/auth/rate-limit";

/**
 * `forgotPasswordAction` must never let its response shape reveal
 * whether an email is registered, so the fake Supabase client below can
 * be told to succeed or fail per call — the action's own response
 * should be identical either way.
 */
const state = vi.hoisted(() => ({
  resetCalls: [] as { email: string; redirectTo: string }[],
  nextResetError: null as { message: string } | null,
}));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ host: "app.test", "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.1" }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      resetPasswordForEmail: async (email: string, opts: { redirectTo: string }) => {
        state.resetCalls.push({ email, redirectTo: opts.redirectTo });
        return { data: {}, error: state.nextResetError };
      },
    },
  }),
}));

const { forgotPasswordAction } = await import("@/lib/auth/actions");

function formDataFor(email: string) {
  const formData = new FormData();
  formData.set("email", email);
  return formData;
}

beforeEach(() => {
  state.resetCalls = [];
  state.nextResetError = null;
  resetRateLimiter();
});

describe("forgotPasswordAction", () => {
  it("returns the same confirmation for a registered email as for an unregistered one", async () => {
    state.nextResetError = null; // Supabase would call this a known/existing user
    const forExisting = await forgotPasswordAction({}, formDataFor("owner@akribis.test"));

    state.nextResetError = { message: "User not found" }; // Supabase's own leak-prone signal
    const forUnknown = await forgotPasswordAction({}, formDataFor("nobody@akribis.test"));

    expect(forExisting).toEqual({ success: true });
    expect(forUnknown).toEqual({ success: true });
    // Same shape, no distinguishing field — this is the actual guarantee.
    expect(forExisting).toEqual(forUnknown);
  });

  it("still calls resetPasswordForEmail with the reset redirect for a plausible email", async () => {
    await forgotPasswordAction({}, formDataFor("owner@akribis.test"));

    expect(state.resetCalls).toHaveLength(1);
    expect(state.resetCalls[0]!.email).toBe("owner@akribis.test");
    expect(state.resetCalls[0]!.redirectTo).toContain("/reinitialiser-mot-de-passe");
  });

  it("rejects a malformed email before touching Supabase, with a distinct format error", async () => {
    const result = await forgotPasswordAction({}, formDataFor("not-an-email"));

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(state.resetCalls).toHaveLength(0);
  });

  it("stops calling Supabase once the same email exceeds the rate limit, without changing the response", async () => {
    const email = "repeat@akribis.test";
    const results = [];
    for (let i = 0; i < DEFAULT_MAX_ATTEMPTS + 3; i++) {
      results.push(await forgotPasswordAction({}, formDataFor(email)));
    }

    // Every single response looks identical, whether it was actually
    // processed or silently throttled.
    for (const result of results) {
      expect(result).toEqual({ success: true });
    }

    expect(state.resetCalls.length).toBeLessThanOrEqual(DEFAULT_MAX_ATTEMPTS);
    expect(state.resetCalls.length).toBeGreaterThan(0);
  });
});
