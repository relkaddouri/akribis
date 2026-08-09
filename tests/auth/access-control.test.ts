import { describe, expect, it } from "vitest";
import {
  canAccess,
  isOwnerOnlyPath,
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
