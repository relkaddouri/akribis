import { NextRequest } from "next/server";
import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

type FakeUser = {
  app_metadata: { role?: string; pharmacy_id?: string };
} | null;

let mockUser: FakeUser = null;
let mockGetUserError: unknown = null;
let mockSessionUser: FakeUser = null;

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: mockUser }, error: mockGetUserError }),
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

afterEach(() => {
  mockUser = null;
  mockGetUserError = null;
  mockSessionUser = null;
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
