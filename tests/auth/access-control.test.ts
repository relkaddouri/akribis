import { describe, expect, it } from "vitest";
import {
  canAccess,
  isOwnerOnlyPath,
  isProtectedPath,
  resolveAuthRedirect,
} from "@/lib/auth/access-control";

describe("isOwnerOnlyPath", () => {
  it("flags settings and stats as owner-only", () => {
    expect(isOwnerOnlyPath("/parametres")).toBe(true);
    expect(isOwnerOnlyPath("/parametres/team")).toBe(true);
    expect(isOwnerOnlyPath("/dashboard/stats")).toBe(true);
  });

  it("does not flag the general dashboard", () => {
    expect(isOwnerOnlyPath("/dashboard")).toBe(false);
  });
});

describe("canAccess", () => {
  it("blocks an assistant from owner-only routes", () => {
    expect(canAccess("assistant", "/parametres")).toBe(false);
    expect(canAccess("assistant", "/dashboard/stats")).toBe(false);
  });

  it("allows an owner everywhere in the dashboard", () => {
    expect(canAccess("owner", "/parametres")).toBe(true);
    expect(canAccess("owner", "/dashboard/stats")).toBe(true);
    expect(canAccess("owner", "/dashboard")).toBe(true);
  });

  it("allows an assistant on the general dashboard", () => {
    expect(canAccess("assistant", "/dashboard")).toBe(true);
  });

  it("blocks an unauthenticated visitor from any dashboard route", () => {
    expect(canAccess(null, "/dashboard")).toBe(false);
  });

  it("allows anyone on public routes", () => {
    expect(canAccess(null, "/login")).toBe(true);
    expect(canAccess("assistant", "/")).toBe(true);
  });
});

describe("resolveAuthRedirect", () => {
  it("sends an unauthenticated visitor to /login", () => {
    expect(
      resolveAuthRedirect({ pathname: "/dashboard", isAuthenticated: false, role: null }),
    ).toBe("/login");
    expect(
      resolveAuthRedirect({
        pathname: "/parametres",
        isAuthenticated: false,
        role: null,
      }),
    ).toBe("/login");
  });

  it("bounces an authenticated assistant away from owner-only routes", () => {
    expect(
      resolveAuthRedirect({
        pathname: "/parametres",
        isAuthenticated: true,
        role: "assistant",
      }),
    ).toBe("/dashboard");
    expect(
      resolveAuthRedirect({
        pathname: "/dashboard/stats",
        isAuthenticated: true,
        role: "assistant",
      }),
    ).toBe("/dashboard");
  });

  it("lets an authenticated owner through owner-only routes", () => {
    expect(
      resolveAuthRedirect({
        pathname: "/parametres",
        isAuthenticated: true,
        role: "owner",
      }),
    ).toBeNull();
  });

  it("lets an authenticated assistant through the general dashboard", () => {
    expect(
      resolveAuthRedirect({
        pathname: "/dashboard",
        isAuthenticated: true,
        role: "assistant",
      }),
    ).toBeNull();
  });

  it("redirects an already-authenticated visitor away from /login", () => {
    expect(
      resolveAuthRedirect({ pathname: "/login", isAuthenticated: true, role: "owner" }),
    ).toBe("/dashboard");
  });

  it("redirects an already-authenticated visitor away from /inscription", () => {
    expect(
      resolveAuthRedirect({ pathname: "/inscription", isAuthenticated: true, role: "owner" }),
    ).toBe("/dashboard");
  });

  it("lets a signed-out visitor reach /inscription", () => {
    expect(
      resolveAuthRedirect({ pathname: "/inscription", isAuthenticated: false, role: null }),
    ).toBeNull();
  });

  it("leaves public routes alone", () => {
    expect(
      resolveAuthRedirect({ pathname: "/", isAuthenticated: false, role: null }),
    ).toBeNull();
  });
});

describe("inventory routes", () => {
  /**
   * The layout's requireUser() would bounce a signed-out visitor anyway,
   * but the middleware has to know about the route too: that is the layer
   * that redirects before any server component runs, and every other
   * module is listed there.
   */
  it("requires a session, like every other module", () => {
    expect(isProtectedPath("/inventaire")).toBe(true);
    expect(isProtectedPath("/inventaire/session-1")).toBe(true);
    expect(canAccess(null, "/inventaire")).toBe(false);
  });

  it("is open to assistants as well as owners", () => {
    // Counting shelves is exactly the kind of work an assistant does; only
    // settings and financial statistics are owner-only.
    expect(canAccess("assistant", "/inventaire")).toBe(true);
    expect(canAccess("owner", "/inventaire")).toBe(true);
    expect(isOwnerOnlyPath("/inventaire")).toBe(false);
  });
});

describe("a signed-in account with no role", () => {
  /**
   * An account created with « Add user » in the Supabase dashboard has no
   * `app_metadata.role`. It used to be sent from /dashboard to
   * defaultPathForRole(null) — /dashboard again — until the browser gave
   * up with "redirect count exceeded".
   */
  const noRole = (pathname: string) =>
    resolveAuthRedirect({ pathname, isAuthenticated: true, role: null });

  it("is sent from /dashboard to /login with an explanation", () => {
    expect(noRole("/dashboard")).toBe("/login?raison=sans-role");
  });

  it("is sent from the back-office to /login with an explanation", () => {
    expect(noRole("/admin/catalogue")).toBe("/login?raison=sans-role");
  });

  it("is allowed to stay on /login and /inscription", () => {
    expect(noRole("/login")).toBeNull();
    expect(noRole("/inscription")).toBeNull();
  });

  it("is never redirected back to the page it asked for, nor in a cycle", () => {
    for (const start of ["/dashboard", "/dashboard/stats", "/parametres", "/admin", "/admin/catalogue", "/login", "/inscription"]) {
      const visited = new Set<string>();
      let pathname: string | null = start;
      while (pathname) {
        expect(visited.has(pathname), `boucle via ${pathname} depuis ${start}`).toBe(false);
        visited.add(pathname);
        const next = noRole(pathname);
        pathname = next ? new URL(next, "http://x").pathname : null;
      }
      expect(visited.size).toBeLessThanOrEqual(2);
    }
  });
});
