/**
 * Guard rail for every script that writes to a database.
 *
 * The seed scripts read `DATABASE_URL` from whatever `.env` happens to be
 * on disk. With one env file that was fine; with a staging database and a
 * production database it is a loaded gun — the same command wipes or
 * rewrites rows in whichever project the file currently points at, and
 * nothing on screen says which one that was.
 *
 * So a script must be told, explicitly, what kind of database it is
 * talking to. Unlabelled means refused: the failure mode of guessing is
 * silently rewriting live pharmacy data.
 */

export type DbEnvironment = "development" | "staging" | "production";

const ENVIRONMENTS: DbEnvironment[] = ["development", "staging", "production"];

/**
 * Parses a connection string far enough to name the target. Returns null
 * when it is not a usable Postgres URL — a placeholder left unedited, a
 * truncated paste — which the caller must treat as a refusal, not as an
 * unknown to push past.
 */
function parseTarget(url: string): { host: string; port: string; database: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) return null;
  if (!parsed.hostname) return null;
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    database: parsed.pathname.replace(/^\//, "") || "(défaut)",
  };
}

/** Host, port and database of a connection string — never the password. */
export function describeTarget(url: string): string {
  const target = parseTarget(url);
  // Never echo the string itself: it carries the password.
  if (!target) return "(chaîne de connexion illisible)";
  return `${target.host}:${target.port}/${target.database}`;
}

export type GuardInput = {
  databaseUrl: string | undefined;
  dbEnvironment: string | undefined;
  allowProduction: string | undefined;
};

export type GuardVerdict =
  | { ok: true; environment: DbEnvironment; target: string }
  | { ok: false; reason: string };

/**
 * Pure decision, so the rules are testable without a database or a
 * process to kill.
 */
export function checkSeedTarget(input: GuardInput): GuardVerdict {
  if (!input.databaseUrl?.trim()) {
    return { ok: false, reason: "DATABASE_URL est absente ou vide." };
  }

  const parsed = parseTarget(input.databaseUrl);
  if (!parsed) {
    // Seen with a freshly created .env.staging still holding its
    // placeholders: the guard waved it through and the failure surfaced as
    // a raw DNS error from `pg`, several layers down. A guard that cannot
    // tell which database it is pointed at has to refuse.
    return {
      ok: false,
      reason:
        "DATABASE_URL n'est pas une URL Postgres exploitable.\n" +
        "Vérifiez que le fichier d'environnement ne contient pas encore ses valeurs d'exemple.",
    };
  }

  const target = describeTarget(input.databaseUrl);
  const label = input.dbEnvironment?.trim().toLowerCase();

  if (!label) {
    return {
      ok: false,
      reason:
        `Base cible : ${target}\n` +
        "Impossible de savoir s'il s'agit de la production. Ajoutez une ligne\n" +
        "  DB_ENVIRONMENT=development   (ou staging, ou production)\n" +
        "au fichier .env correspondant, puis relancez.",
    };
  }

  if (!ENVIRONMENTS.includes(label as DbEnvironment)) {
    return {
      ok: false,
      reason: `DB_ENVIRONMENT="${label}" n'est pas reconnu (attendu : ${ENVIRONMENTS.join(", ")}).`,
    };
  }

  const environment = label as DbEnvironment;

  if (environment === "production" && input.allowProduction?.trim().toLowerCase() !== "oui") {
    return {
      ok: false,
      reason:
        `Base cible : ${target}\n` +
        "Cette base est déclarée comme PRODUCTION. Un seed y écrase des données réelles.\n" +
        "Si c'est réellement voulu, relancez avec :\n" +
        "  ALLOW_PRODUCTION_SEED=oui npm run <script>",
    };
  }

  return { ok: true, environment, target };
}

/**
 * Called at the top of every seed. Prints what it is about to write to,
 * so the target is visible in the terminal history afterwards — "I thought
 * it was staging" is the whole failure mode this exists to prevent.
 */
export function assertSafeSeedTarget(): void {
  const verdict = checkSeedTarget({
    databaseUrl: process.env.DATABASE_URL,
    dbEnvironment: process.env.DB_ENVIRONMENT,
    allowProduction: process.env.ALLOW_PRODUCTION_SEED,
  });

  if (!verdict.ok) {
    console.error(`\n✖ Écriture refusée.\n\n${verdict.reason}\n`);
    process.exit(1);
  }

  const banner =
    verdict.environment === "production"
      ? `⚠  PRODUCTION — ${verdict.target}`
      : `→ ${verdict.environment} — ${verdict.target}`;
  console.log(`${banner}\n`);
}
