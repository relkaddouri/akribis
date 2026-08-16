import { describe, expect, it } from "vitest";
import {
  ADMIN_CATALOGUE_PATH,
  canAccess,
  defaultPathForRole,
  isAdminOnlyPath,
  isOwnerOnlyPath,
  isProtectedPath,
  resolveAuthRedirect,
} from "@/lib/auth/access-control";
import { ADMIN_ROLE, isAdminRole, isPharmacyRole, isRole } from "@/lib/auth/roles";

/**
 * The whole point of this file: the Akribis back-office holds the national
 * product catalogue, shared by every pharmacy on the platform. A titulaire
 * editing it would be editing their competitors' data.
 */

const ADMIN_PAGES = [
  "/admin",
  ADMIN_CATALOGUE_PATH,
  "/admin/catalogue/nouveau",
  "/admin/catalogue/import",
  "/admin/catalogue/8f3c1a2e-0000-4000-8000-000000000000",
];

describe("le rôle admin_akribis", () => {
  it("existe et se distingue de owner/assistant", () => {
    expect(isRole(ADMIN_ROLE)).toBe(true);
    expect(isAdminRole(ADMIN_ROLE)).toBe(true);
    expect(isAdminRole("owner")).toBe(false);
    expect(isAdminRole("assistant")).toBe(false);
    expect(isPharmacyRole(ADMIN_ROLE)).toBe(false);
  });

  it("ne se laisse pas confondre avec une valeur approchante", () => {
    expect(isRole("admin")).toBe(false);
    expect(isRole("ADMIN_AKRIBIS")).toBe(false);
    expect(isRole("")).toBe(false);
    expect(isRole(null)).toBe(false);
  });
});

describe("un titulaire (owner) ne peut pas atteindre l'espace Admin", () => {
  it.each(ADMIN_PAGES)("canAccess refuse %s", (path) => {
    expect(canAccess("owner", path)).toBe(false);
  });

  it.each(ADMIN_PAGES)("le middleware le renvoie vers son tableau de bord — %s", (path) => {
    expect(resolveAuthRedirect({ pathname: path, isAuthenticated: true, role: "owner" })).toBe(
      "/dashboard",
    );
  });
});

describe("un assistant ne peut pas atteindre l'espace Admin", () => {
  it.each(ADMIN_PAGES)("canAccess refuse %s", (path) => {
    expect(canAccess("assistant", path)).toBe(false);
  });

  it.each(ADMIN_PAGES)("le middleware le renvoie vers son tableau de bord — %s", (path) => {
    expect(resolveAuthRedirect({ pathname: path, isAuthenticated: true, role: "assistant" })).toBe(
      "/dashboard",
    );
  });
});

describe("un visiteur non connecté ne peut pas atteindre l'espace Admin", () => {
  it.each(ADMIN_PAGES)("est protégé et renvoie vers /login — %s", (path) => {
    expect(isProtectedPath(path)).toBe(true);
    expect(canAccess(null, path)).toBe(false);
    expect(resolveAuthRedirect({ pathname: path, isAuthenticated: false, role: null })).toBe(
      "/login",
    );
  });
});

describe("un admin_akribis passe, et seulement là", () => {
  it.each(ADMIN_PAGES)("accède à %s", (path) => {
    expect(canAccess(ADMIN_ROLE, path)).toBe(true);
    expect(resolveAuthRedirect({ pathname: path, isAuthenticated: true, role: ADMIN_ROLE })).toBeNull();
  });

  /**
   * La réciproque compte autant : un admin n'a pas de `pharmacy_id`, donc
   * toute page pharmacie ferait une requête sans périmètre.
   */
  it.each([
    "/dashboard",
    "/dashboard/pos",
    "/dashboard/stock",
    "/parametres",
    "/ventes",
    "/inventaire",
    "/commandes",
  ])("est refusé sur la page pharmacie %s", (path) => {
    expect(canAccess(ADMIN_ROLE, path)).toBe(false);
    expect(resolveAuthRedirect({ pathname: path, isAuthenticated: true, role: ADMIN_ROLE })).toBe(
      ADMIN_CATALOGUE_PATH,
    );
  });

  it("atterrit sur le catalogue après connexion", () => {
    expect(defaultPathForRole(ADMIN_ROLE)).toBe(ADMIN_CATALOGUE_PATH);
    expect(defaultPathForRole("owner")).toBe("/dashboard");
    expect(defaultPathForRole("assistant")).toBe("/dashboard");
    expect(
      resolveAuthRedirect({ pathname: "/login", isAuthenticated: true, role: ADMIN_ROLE }),
    ).toBe(ADMIN_CATALOGUE_PATH);
  });
});

describe("le cloisonnement ne casse pas les règles existantes", () => {
  it("laisse owner et assistant travailler comme avant", () => {
    expect(canAccess("owner", "/parametres")).toBe(true);
    expect(canAccess("assistant", "/dashboard")).toBe(true);
    expect(canAccess("assistant", "/parametres")).toBe(false);
    expect(canAccess("assistant", "/dashboard/stats")).toBe(false);
  });

  it("ne confond pas « réservé au titulaire » et « réservé à Akribis »", () => {
    expect(isOwnerOnlyPath("/admin/catalogue")).toBe(false);
    expect(isAdminOnlyPath("/parametres")).toBe(false);
    expect(isAdminOnlyPath("/dashboard/stats")).toBe(false);
  });

  /**
   * `/administration-des-ventes` n'existe pas, mais le jour où une route
   * pharmacie commencera par « admin », un préfixe naïf lui ouvrirait
   * l'espace Akribis. Ce test fixe la frontière sur le segment entier.
   */
  it("ne traite pas n'importe quelle route commençant par « admin » comme l'espace Akribis", () => {
    expect(isAdminOnlyPath("/administration-des-ventes")).toBe(false);
    expect(canAccess("owner", "/administration-des-ventes")).toBe(true);
  });
});
