import { NextRequest } from "next/server";
import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { missingSupabaseConfig } from "@/lib/supabase/middleware";

type FakeUser = {
  app_metadata: { role?: string; pharmacy_id?: string };
} | null;

let mockUser: FakeUser = null;
let mockGetUserError: unknown = null;
let mockThrowOnGetUser: Error | null = null;
let mockSessionUser: FakeUser = null;

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => {
        if (mockThrowOnGetUser) throw mockThrowOnGetUser;
        return { data: { user: mockUser }, error: mockGetUserError };
      },
      getSession: async () => ({
        data: { session: mockSessionUser ? { user: mockSessionUser } : null },
      }),
    },
  }),
}));

const { middleware } = await import("@/middleware");

function requestFor(pathname: string) {
  return new NextRequest(new URL(pathname, "http://localhost:3000"));
}

beforeEach(() => {
  // The middleware now refuses to run without them, which is the point of
  // the hardening — so the suite has to supply them like a real deployment.
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  mockUser = null;
  mockGetUserError = null;
  mockSessionUser = null;
  mockThrowOnGetUser = null;
});

describe("middleware", () => {
  it("redirects an unauthenticated visitor away from /dashboard to /login", async () => {
    mockUser = null;

    const response = await middleware(requestFor("/dashboard"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  });

  it("blocks a signed-in assistant from /parametres", async () => {
    mockUser = { app_metadata: { role: "assistant", pharmacy_id: "pharmacy-1" } };

    const response = await middleware(requestFor("/parametres"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/dashboard");
  });

  it("blocks a signed-in assistant from /dashboard/stats", async () => {
    mockUser = { app_metadata: { role: "assistant", pharmacy_id: "pharmacy-1" } };

    const response = await middleware(requestFor("/dashboard/stats"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/dashboard");
  });

  it("lets a signed-in owner reach /parametres", async () => {
    mockUser = { app_metadata: { role: "owner", pharmacy_id: "pharmacy-1" } };

    const response = await middleware(requestFor("/parametres"));

    expect(response.status).toBe(200);
  });

  it("lets a signed-in assistant reach the general /dashboard", async () => {
    mockUser = { app_metadata: { role: "assistant", pharmacy_id: "pharmacy-1" } };

    const response = await middleware(requestFor("/dashboard"));

    expect(response.status).toBe(200);
  });

  describe("when Supabase's auth server is unreachable", () => {
    it("keeps an already-authenticated visitor on a protected route via the locally cached session", async () => {
      mockUser = null; // getUser() couldn't verify anything
      mockGetUserError = new AuthRetryableFetchError("fetch failed", 0);
      mockSessionUser = { app_metadata: { role: "owner", pharmacy_id: "pharmacy-1" } };

      const response = await middleware(requestFor("/dashboard/stock"));

      // No redirect — the request is allowed through despite getUser()
      // failing, because the cookie-derived session says they're signed in.
      expect(response.status).toBe(200);
    });

    it("still enforces owner-only routes using the locally cached session's role", async () => {
      mockUser = null;
      mockGetUserError = new AuthRetryableFetchError("fetch failed", 0);
      mockSessionUser = { app_metadata: { role: "assistant", pharmacy_id: "pharmacy-1" } };

      const response = await middleware(requestFor("/parametres"));

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe("/dashboard");
    });

    it("still redirects to /login when there is no local session either", async () => {
      mockUser = null;
      mockGetUserError = new AuthRetryableFetchError("fetch failed", 0);
      mockSessionUser = null; // never logged in on this browser, or token fully expired

      const response = await middleware(requestFor("/dashboard"));

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    });
  });
});

describe("surviving a broken configuration", () => {
  /**
   * The Vercel failure mode: MIDDLEWARE_INVOCATION_FAILED on every page,
   * with nothing in the response to say why. `createServerClient` throws
   * when handed an undefined URL, and NEXT_PUBLIC_* values are inlined at
   * build time — so a variable missing during the build is baked in as
   * undefined and every single request dies.
   */
  it("names every missing variable rather than failing on the first", () => {
    expect(missingSupabaseConfig({ url: undefined, anonKey: undefined })).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]);
  });

  it("treats an empty string as missing", () => {
    // Far more common than a genuinely absent variable: a dashboard field
    // saved blank, or a value that is nothing but whitespace.
    expect(missingSupabaseConfig({ url: "", anonKey: "key" })).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
    expect(missingSupabaseConfig({ url: "   ", anonKey: "key" })).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
  });

  it("is satisfied by a complete configuration", () => {
    expect(
      missingSupabaseConfig({ url: "https://x.supabase.co", anonKey: "anon" }),
    ).toEqual([]);
  });
});

describe("what a broken configuration does to a request", () => {
  it("sends the visitor to a page that explains it, instead of a blank 500", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");

    const response = await middleware(requestFor("/dashboard"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/erreur-configuration");
  });

  it("does not bounce the error page against itself", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");

    const response = await middleware(requestFor("/erreur-configuration"));

    // Redirecting here too would loop until the browser gives up.
    expect(response.headers.get("location")).toBeNull();
  });

  it("lets the request through when the auth check throws unexpectedly", async () => {
    // Not a configuration problem — Supabase itself misbehaving. Every
    // protected page still calls requireUser(), so letting this through
    // degrades the app instead of taking all of it down.
    mockGetUserError = null;
    mockThrowOnGetUser = new Error("boom");

    const response = await middleware(requestFor("/dashboard"));

    expect(response.headers.get("location")).toBeNull();
    mockThrowOnGetUser = null;
  });
});
