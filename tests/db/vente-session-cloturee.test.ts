import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/**
 * L'immuabilité des ventes d'une session clôturée, **contre la vraie base**.
 *
 * Comme pour event_log, la garantie tient à un déclencheur PostgreSQL et
 * non à une vérification applicative : un Journal Z archivé qui cesserait
 * de correspondre aux ventes qu'il résume ne vaudrait plus rien, et un
 * contrôle applicatif ne survit pas au premier script lancé à la main.
 *
 * Ce que ce fichier vérifie surtout, c'est la **frontière** : la demande
 * disait « la vente ne peut plus être modifiée », mais un retour écrit
 * `return_status`, la facturation `invoice_id`, et le rapprochement
 * `statut_creance`. Geler la ligne entière casserait le retour que la
 * demande veut justement préserver. Le déclencheur gèle donc la substance
 * financière — ce qu'un Z additionne — et laisse passer le suivi.
 *
 * Tout se passe dans des transactions annulées.
 */

const RESTRICT_VIOLATION = "23001";

function chaineDeConnexion(): string | null {
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
const avecBase = url ? describe : describe.skip;

avecBase("une vente d'une session clôturée est figée en base", () => {
  let db: Client;
  let pharmacyId: string;
  let userId: string;

  beforeAll(async () => {
    db = new Client({ connectionString: url! });
    await db.connect();
    // Une officine réelle de la base d'essai : les clés étrangères
    // exigent des lignes existantes, et en créer effacerait la frontière
    // entre le test et les données.
    const p = await db.query('SELECT id FROM "pharmacies" LIMIT 1');
    const u = await db.query('SELECT id FROM "users" LIMIT 1');
    pharmacyId = p.rows[0]?.id;
    userId = u.rows[0]?.id;
  });

  afterAll(async () => {
    await db?.end();
  });

  /** Une session close et une vente rattachée, dans la transaction en cours. */
  async function venteClose(): Promise<string> {
    const suffixe = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const sessionId = `essai-session-${suffixe}`;
    const venteId = `essai-vente-${suffixe}`;

    await db.query(
      `INSERT INTO "caisse_sessions"
         ("id","pharmacy_id","ouverte_par","fond_caisse_initial","statut",
          "numero_z","date_fermeture","updated_at")
       VALUES ($1,$2,$3,200,'cloturee',$4,NOW(),NOW())`,
      [sessionId, pharmacyId, userId, `Z-ESSAI-${suffixe}`],
    );
    await db.query(
      `INSERT INTO "sales"
         ("id","pharmacy_id","payment_method","total_amount","caisse_session_id")
       VALUES ($1,$2,'cash',150.00,$3)`,
      [venteId, pharmacyId, sessionId],
    );
    return venteId;
  }

  it("dispose bien d'une officine et d'un utilisateur pour l'essai", () => {
    // Garde-fou du test : sans ces deux lignes, les insertions
    // échoueraient sur la clé étrangère et les refus attendus
    // arriveraient pour la mauvaise raison.
    expect(pharmacyId, "aucune pharmacie en base").toBeTruthy();
    expect(userId, "aucun utilisateur en base").toBeTruthy();
  });

  it("refuse de changer le montant", async () => {
    await db.query("BEGIN");
    try {
      const id = await venteClose();
      await expect(
        db.query('UPDATE "sales" SET "total_amount" = 999 WHERE "id" = $1', [id]),
      ).rejects.toMatchObject({ code: RESTRICT_VIOLATION });
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("refuse de changer le mode de paiement", async () => {
    // Basculer une vente d'espèces à carte après coup fausserait l'écart
    // de caisse du Z déjà archivé.
    await db.query("BEGIN");
    try {
      const id = await venteClose();
      await expect(
        db.query(`UPDATE "sales" SET "payment_method" = 'card' WHERE "id" = $1`, [id]),
      ).rejects.toMatchObject({ code: RESTRICT_VIOLATION });
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("refuse de déplacer la vente vers une autre session", async () => {
    await db.query("BEGIN");
    try {
      const id = await venteClose();
      await expect(
        db.query('UPDATE "sales" SET "caisse_session_id" = NULL WHERE "id" = $1', [id]),
      ).rejects.toMatchObject({ code: RESTRICT_VIOLATION });
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("refuse la suppression, sans exception", async () => {
    await db.query("BEGIN");
    try {
      const id = await venteClose();
      await expect(db.query('DELETE FROM "sales" WHERE "id" = $1', [id])).rejects.toMatchObject({
        code: RESTRICT_VIOLATION,
      });
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("laisse passer un retour, qui écrit return_status", async () => {
    // Le point de la demande : un retour reste possible sur une vente
    // d'une session close. C'est aussi ce qu'une contrainte trop large
    // aurait cassé sans qu'on s'en aperçoive avant la production.
    await db.query("BEGIN");
    try {
      const id = await venteClose();
      await db.query(`UPDATE "sales" SET "return_status" = 'partial' WHERE "id" = $1`, [id]);
      const lu = await db.query('SELECT "return_status" FROM "sales" WHERE "id" = $1', [id]);
      expect(lu.rows[0].return_status).toBe("partial");
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("laisse passer la facturation et le rapprochement de bordereau", async () => {
    await db.query("BEGIN");
    try {
      const id = await venteClose();
      await db.query(`UPDATE "sales" SET "statut_creance" = 'payee' WHERE "id" = $1`, [id]);
      const lu = await db.query('SELECT "statut_creance" FROM "sales" WHERE "id" = $1', [id]);
      expect(lu.rows[0].statut_creance).toBe("payee");
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("ne gêne pas une vente dont la session est encore ouverte", async () => {
    // Sans cette vérification, un déclencheur qui refuserait tout
    // passerait les cas ci-dessus tout en bloquant la journée en cours.
    await db.query("BEGIN");
    try {
      const suffixe = `${Date.now()}-ouverte`;
      const sessionId = `essai-session-${suffixe}`;
      const venteId = `essai-vente-${suffixe}`;

      // Un index partiel n'autorise qu'une session ouverte par officine, et
      // la base d'essai en a une vraie dès que quelqu'un se sert de
      // l'application. On la clôt dans la transaction — annulée juste
      // après — plutôt que de faire dépendre le test de l'état du moment.
      await db.query(
        `UPDATE "caisse_sessions" SET "statut" = 'cloturee'
          WHERE "pharmacy_id" = $1 AND "statut" = 'ouverte'`,
        [pharmacyId],
      );

      await db.query(
        `INSERT INTO "caisse_sessions"
           ("id","pharmacy_id","ouverte_par","fond_caisse_initial","statut","updated_at")
         VALUES ($1,$2,$3,200,'ouverte',NOW())`,
        [sessionId, pharmacyId, userId],
      );
      await db.query(
        `INSERT INTO "sales"
           ("id","pharmacy_id","payment_method","total_amount","caisse_session_id")
         VALUES ($1,$2,'cash',150.00,$3)`,
        [venteId, pharmacyId, sessionId],
      );

      await db.query('UPDATE "sales" SET "total_amount" = 175 WHERE "id" = $1', [venteId]);
      const lu = await db.query('SELECT "total_amount" FROM "sales" WHERE "id" = $1', [venteId]);
      expect(Number(lu.rows[0].total_amount)).toBe(175);
    } finally {
      await db.query("ROLLBACK");
    }
  });

  it("n'a laissé aucune trace de ses essais", async () => {
    const restes = await db.query(
      `SELECT count(*)::int AS n FROM "sales" WHERE "id" LIKE 'essai-vente-%'`,
    );
    expect(restes.rows[0].n).toBe(0);
  });
});
