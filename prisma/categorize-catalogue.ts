/**
 * Classe en « Pharmaceutique » les fiches catalogue encore sans catégorie.
 *
 *   npm run categorize:catalogue -- --dry-run   (n'écrit rien, montre le plan)
 *   npm run categorize:catalogue
 *
 * Pourquoi : les 5 917 fiches issues du référentiel CNOPS 2014 sont toutes
 * des médicaments, mais le fichier source ne porte pas la catégorie du PRD
 * (pharmaceutique / parapharmaceutique / dispositif médical). La migration
 * de phase 1 les a donc laissées à NULL — « À classer » dans l'interface —
 * plutôt que d'inventer une valeur dont dépend le taux de TVA.
 *
 * Maintenant que la question est tranchée, et AVANT d'importer les premiers
 * produits de parapharmacie, il faut fixer cette catégorie : une fois les
 * deux familles mélangées dans la table, plus rien ne permettra de dire
 * lesquelles étaient des médicaments.
 *
 * `pg` et SQL brut plutôt que le client Prisma, comme les autres scripts de
 * ce dossier : Node nu ne résout pas les imports du client généré.
 */

import "dotenv/config";
import { Client } from "pg";
import { assertSafeSeedTarget } from "./seed-guard.ts";

/**
 * « À classer » n'existe pas en base : l'enum `produit_categorie` ne connaît
 * que pharmaceutique / parapharmaceutique / dispositif_medical. C'est le
 * libellé que l'interface affiche pour un NULL. La cible est donc, très
 * exactement, `categorie IS NULL`.
 */
const SANS_CATEGORIE = `"categorie" IS NULL`;

const CIBLE = "PHARMACEUTIQUE";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // Refuse de tourner sur une base non étiquetée, et affiche l'hôte visé
  // avant toute écriture. Même garde-fou que les scripts de seed.
  assertSafeSeedTarget();

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const one = async (sql: string) => Number((await client.query(sql)).rows[0].n);

    const total = await one(`SELECT count(*) n FROM "catalogue_produits"`);
    const aClasser = await one(`SELECT count(*) n FROM "catalogue_produits" WHERE ${SANS_CATEGORIE}`);
    const dejaClassees = total - aClasser;

    const { rows: repartition } = await client.query<{ categorie: string | null; n: string }>(`
      SELECT "categorie"::text AS categorie, count(*) n
      FROM "catalogue_produits"
      GROUP BY "categorie"
      ORDER BY n DESC
    `);

    console.log("Catégorisation du catalogue\n");
    console.log(`  fiches au total              ${total}`);
    console.log(`  déjà catégorisées            ${dejaClassees}  (jamais touchées)`);
    console.log(`  à classer (categorie NULL)   ${aClasser}`);
    console.log("\n  Répartition actuelle :");
    for (const row of repartition) {
      console.log(`    ${(row.categorie ?? "À classer (NULL)").padEnd(22)} ${row.n}`);
    }

    if (aClasser === 0) {
      console.log("\n✓ Rien à faire : aucune fiche sans catégorie.\n");
      return;
    }

    // Un échantillon, pour que ce qui va être écrit soit reconnaissable
    // avant de l'écrire.
    const { rows: exemples } = await client.query<{ nom: string; forme: string }>(`
      SELECT "nom", "forme_galenique" AS forme
      FROM "catalogue_produits"
      WHERE ${SANS_CATEGORIE}
      ORDER BY "nom" LIMIT 5
    `);
    console.log(`\n  Exemples parmi les ${aClasser} concernées :`);
    for (const row of exemples) console.log(`    · ${row.nom} — ${row.forme}`);

    if (dryRun) {
      console.log(`\n[dry-run] ${aClasser} ligne(s) passeraient à « ${CIBLE} ». Rien n'a été écrit.\n`);
      return;
    }

    // Tout ou rien, et la clause `IS NULL` est répétée dans l'UPDATE : elle
    // est la garantie qu'une fiche classée à la main entre-temps — y compris
    // pendant l'exécution — ne sera pas écrasée.
    await client.query("BEGIN");
    const result = await client.query(`
      UPDATE "catalogue_produits"
      SET "categorie" = '${CIBLE.toLowerCase()}'::"produit_categorie",
          "updated_at" = now()
      WHERE ${SANS_CATEGORIE}
    `);
    await client.query("COMMIT");

    const restantes = await one(`SELECT count(*) n FROM "catalogue_produits" WHERE ${SANS_CATEGORIE}`);
    const apresTotal = await one(`SELECT count(*) n FROM "catalogue_produits"`);

    console.log(`\n  lignes mises à jour          ${result.rowCount}`);
    console.log(`  fiches au total              ${total} → ${apresTotal}`);
    console.log(`  encore « À classer »         ${restantes}`);

    if (apresTotal !== total) {
      console.error("\n✖ Le nombre de fiches a changé — cela ne devrait jamais arriver.");
      process.exit(1);
    }

    const { rows: apres } = await client.query<{ categorie: string | null; n: string }>(`
      SELECT "categorie"::text AS categorie, count(*) n
      FROM "catalogue_produits" GROUP BY "categorie" ORDER BY n DESC
    `);
    console.log("\n  Répartition finale :");
    for (const row of apres) {
      console.log(`    ${(row.categorie ?? "À classer (NULL)").padEnd(22)} ${row.n}`);
    }

    if (restantes === 0) {
      console.log(
        "\n✓ Plus aucune fiche « À classer ». Les produits issus de l'import CNOPS\n" +
          "  sont tous classés comme médicaments ; la parapharmacie à venir sera\n" +
          "  donc distinguable de l'existant.\n",
      );
    } else {
      console.log(
        `\n⚠ ${restantes} fiche(s) restent sans catégorie. Elles ont été créées après\n` +
          "  le début de ce script — relancez-le pour les inclure.\n",
      );
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("\nCatégorisation interrompue, rien n'a été écrit :\n", error);
  process.exit(1);
});
