import { describe, expect, it } from "vitest";
import { checkSeedTarget, describeTarget } from "@/prisma/seed-guard";

/**
 * The rules that stand between `npm run seed:...` and the live pharmacy
 * database. With one env file the seed was harmless; with a staging
 * project and a production project, the same command rewrites whichever
 * one `.env` currently points at, and nothing on screen says which.
 */
const STAGING = "postgresql://postgres:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres";

describe("naming the target", () => {
  it("shows host, port and database", () => {
    expect(describeTarget(STAGING)).toBe(
      "aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
    );
  });

  it("never echoes the password", () => {
    // This string ends up in terminal history and in CI logs.
    expect(describeTarget(STAGING)).not.toContain("secret");
  });

  it("says so plainly when the string is unusable, rather than leaking it", () => {
    expect(describeTarget("pas-une-url")).toBe("(chaîne de connexion illisible)");
    expect(describeTarget("pas-une-url")).not.toContain("pas-une-url");
  });
});

describe("deciding whether to write", () => {
  it("refuses an unlabelled database and says what to add", () => {
    const verdict = checkSeedTarget({
      databaseUrl: STAGING,
      dbEnvironment: undefined,
      allowProduction: undefined,
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    // Fail closed: an unlabelled database is the case where a mistake is
    // silent and irreversible.
    expect(verdict.reason).toContain("DB_ENVIRONMENT");
    expect(verdict.reason).toContain("aws-0-eu-west-1.pooler.supabase.com");
  });

  it("allows a labelled staging database", () => {
    const verdict = checkSeedTarget({
      databaseUrl: STAGING,
      dbEnvironment: "staging",
      allowProduction: undefined,
    });

    expect(verdict).toEqual({
      ok: true,
      environment: "staging",
      target: "aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
    });
  });

  it("refuses production unless it is asked for in the command itself", () => {
    const verdict = checkSeedTarget({
      databaseUrl: STAGING,
      dbEnvironment: "production",
      allowProduction: undefined,
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("PRODUCTION");
    expect(verdict.reason).toContain("ALLOW_PRODUCTION_SEED");
  });

  it("allows production only with the explicit opt-in", () => {
    const verdict = checkSeedTarget({
      databaseUrl: STAGING,
      dbEnvironment: "production",
      allowProduction: "oui",
    });

    expect(verdict.ok).toBe(true);
  });

  it("does not accept a vague opt-in", () => {
    // "true", "1", "yes" all read as someone guessing. The word is "oui",
    // and it has to be typed on purpose.
    for (const value of ["true", "1", "yes", "y", ""]) {
      const verdict = checkSeedTarget({
        databaseUrl: STAGING,
        dbEnvironment: "production",
        allowProduction: value,
      });
      expect(verdict.ok).toBe(false);
    }
  });

  it("tolerates casing and stray whitespace in the label", () => {
    const verdict = checkSeedTarget({
      databaseUrl: STAGING,
      dbEnvironment: "  Staging \n",
      allowProduction: undefined,
    });

    expect(verdict.ok).toBe(true);
  });

  it("refuses a label it does not recognise instead of assuming it is safe", () => {
    // "prod" is not "production": a typo must not read as a non-production
    // database and open the gate.
    const verdict = checkSeedTarget({
      databaseUrl: STAGING,
      dbEnvironment: "prod",
      allowProduction: undefined,
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("n'est pas reconnu");
  });

  it("refuses a missing connection string", () => {
    const verdict = checkSeedTarget({
      databaseUrl: undefined,
      dbEnvironment: "staging",
      allowProduction: undefined,
    });

    expect(verdict.ok).toBe(false);
  });
});

describe("a connection string it cannot make sense of", () => {
  /**
   * Found on a freshly created .env.staging still holding its placeholders:
   * the guard waved it through and the failure surfaced several layers down
   * as `ENOTFOUND hostname: 'base'` from `pg`. A guard that cannot tell
   * which database it is pointed at must refuse, not defer.
   */
  it.each([
    ["colle-ton-url-ici"],
    [""],
    ["   "],
    ["https://exemple.com/base"],
    ["postgresql://"],
  ])("refuses %s", (value) => {
    const verdict = checkSeedTarget({
      databaseUrl: value,
      dbEnvironment: "staging",
      allowProduction: undefined,
    });

    expect(verdict.ok).toBe(false);
  });

  it("accepts both postgres:// and postgresql://", () => {
    for (const scheme of ["postgres", "postgresql"]) {
      const verdict = checkSeedTarget({
        databaseUrl: `${scheme}://user:pw@db.example.com:5432/postgres`,
        dbEnvironment: "staging",
        allowProduction: undefined,
      });
      expect(verdict.ok).toBe(true);
    }
  });
});
