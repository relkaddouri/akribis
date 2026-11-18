import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/**
 * L'inviolabilité du journal, vérifiée **contre la vraie base**.
 *
 * Les autres tests du journal (tests/admin/journal-catalogue.test.ts,
 * tests/clients/journal-fiche.test.ts) montent un faux Prisma qui refuse
 * les UPDATE et les DELETE. Ils vérifient que le code ne les tente pas ;
 * ils ne prouvent rien de la base, puisque c'est le test lui-même qui
 * écrit le refus. La garantie tient à un déclencheur PostgreSQL
 * (migration 20260821090000_event_log), et seule une vraie connexion peut
 * dire s'il est en place sur la base où tourne l'application.
 *
 * Tout se passe dans une transaction annulée : la ligne insérée pour
 * l'essai ne survit pas au test, et un journal en ajout seul ne permet
 * de toute façon pas de la retirer après coup.
 */

/** SQLSTATE levé par le déclencheur — `restrict_violation`. */
const RESTRICT_VIOLATION = "23001";

function chaineDeConnexion(): string | null {
  // Le processus de test ne charge pas `.env` ; Next le fait pour
  // l'application, vitest non.
  const direct = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (direct) return direct;

  try {
    const fichier = readFileSync(resolve(__dirname, "../..", ".env"), "utf8");
    const valeurs = Object.fromEntries(
      fichier
        .split("\n")
        .filter((ligne) => ligne.includes("=") && !ligne.trim().startsWith("#"))
        .map((ligne) => {
          const coupure = ligne.indexOf("=");
          return [
            ligne.slice(0, coupure).trim(),
            ligne.slice(coupure + 1).trim().replace(/^["']|["']$/g, ""),
          ];
        }),
    );
    return valeurs.DIRECT_URL ?? valeurs.DATABASE_URL ?? null;
  } catch {
    return null;
  }
}

const url = chaineDeConnexion();

/**
 * Sans base joignable, le fichier se saute au lieu d'échouer.
 *
 * Un test rouge faute de `.env` sur un poste ou en intégration continue
 * apprendrait qu'il manque une variable, pas que le journal est
 * vulnérable — et à force, on cesserait de le lire.
 */
const avecBase = url ? describe : describe.skip;

avecBase("event_log refuse toute réécriture, au niveau de la base", () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({ connectionString: url! });
    await db.connect();
  });

  afterAll(async () => {
    await db?.end();
  });

  /**
   * Insère une entrée d'essai et rend son identifiant, dans une
   * transaction que l'appelant annulera.
   */
  async function entreeDEssai(): Promise<string> {
    const id = `essai-inviolabilite-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await db.query(
      `INSERT INTO "event_log"
         ("id", "acteur_id", "acteur_email", "acteur_role",
          "type_action", "entite", "entite_id", "pharmacy_id")
       VALUES ($1, 'essai', 'essai@akribis.test', 'owner',
               'client.consultation', 'client', 'cli-essai', NULL)`,
      [id],
    );
    return id;
  }

  it("accepte bien une insertion — sans quoi le reste ne prouverait rien", async () => {
    await db.query("BEGIN");
    try {
      const id = await entreeDEssai();
      const lu = await db.query('SELECT "type_action" FROM "event_log" WHERE "id" = $1', [id]);
      expect(lu.rowCount).toBe(1);
      expect(lu.rows[0].type_action).toBe("client.consultation");
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("refuse un UPDATE", async () => {
    await db.query("BEGIN");
    try {
      const id = await entreeDEssai();
      await expect(
        db.query('UPDATE "event_log" SET "acteur_email" = $1 WHERE "id" = $2', [
          "quelqun-dautre@akribis.test",
          id,
        ]),
      ).rejects.toMatchObject({ code: RESTRICT_VIOLATION });
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("refuse un DELETE", async () => {
    await db.query("BEGIN");
    try {
      const id = await entreeDEssai();
      await expect(
        db.query('DELETE FROM "event_log" WHERE "id" = $1', [id]),
      ).rejects.toMatchObject({ code: RESTRICT_VIOLATION });
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("refuse un UPDATE de masse, qui ne vise aucune ligne en particulier", async () => {
    // `FOR EACH ROW` ne se déclenche que s'il y a des lignes : le refus
    // doit venir de l'existence de lignes, pas de la forme de la requête.
    await db.query("BEGIN");
    try {
      await entreeDEssai();
      await expect(
        db.query(`UPDATE "event_log" SET "type_action" = 'falsifie'`),
      ).rejects.toMatchObject({ code: RESTRICT_VIOLATION });
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("refuse un DELETE de masse", async () => {
    // La forme la plus dangereuse : effacer le journal entier en une
    // instruction, ce qu'un script de purge mal cadré ferait sans y penser.
    await db.query("BEGIN");
    try {
      await entreeDEssai();
      await expect(db.query('DELETE FROM "event_log"')).rejects.toMatchObject({
        code: RESTRICT_VIOLATION,
      });
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("laisse un message qui dit ce qui a été refusé", async () => {
    await db.query("BEGIN");
    try {
      const id = await entreeDEssai();
      await expect(
        db.query('DELETE FROM "event_log" WHERE "id" = $1', [id]),
      ).rejects.toThrow(/ajout seul.*DELETE/);
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("n'a laissé aucune trace de ses essais", async () => {
    // Les transactions sont annulées : si l'une ne l'était pas, le journal
    // porterait des entrées d'essai — impossibles à retirer, puisque le
    // DELETE est justement refusé.
    const restes = await db.query(
      `SELECT count(*)::int AS n FROM "event_log" WHERE "id" LIKE 'essai-inviolabilite-%'`,
    );
    expect(restes.rows[0].n).toBe(0);
  });
});
