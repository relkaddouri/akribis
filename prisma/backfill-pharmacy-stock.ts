/**
 * Recopie la fiche catalogue dans `pharmacy_stock`.
 *
 *   npm run backfill:pharmacy-stock -- --dry-run
 *   npm run backfill:pharmacy-stock
 *
 * Correctif de conception : `pharmacy_stock` lisait l'identification, les
 * prix et le descriptif à travers `catalogue_produit_id`. Ces champs y sont
 * désormais dupliqués (migration 20260817012434_pharmacy_stock_full_copy) et
 * ce script les remplit pour les lignes créées avant.
 *
 * Après passage, les deux lignes portent les mêmes valeurs mais sont
 * **indépendantes** : plus rien ne les resynchronise, et modifier l'une
 * n'affecte jamais l'autre.
 *
 * Rejouable. Ne touche qu'aux lignes jamais recopiées (`nom IS NULL`) : une
 * officine qui a depuis corrigé sa copie ne doit pas la voir écrasée par un
 * second passage. C'est ce qui rend le script sûr à relancer, et c'est aussi
 * sa limite — il ne resynchronise pas, par construction.
 *
 * `pg` et SQL brut plutôt que le client Prisma, comme les autres scripts de
 * ce dossier : Node nu ne résout pas les imports du client généré.
 */

import "dotenv/config";
import { Client } from "pg";

/**
 * Les 34 colonnes recopiées. Même nom des deux côtés, ce qui permet de
 * générer le SET et de garantir qu'aucune paire ne peut être mal appariée —
 * l'erreur classique d'un backfill écrit à la main (PPH dans PPV).
 *
 * Volontairement absentes : tout ce qui appartient déjà à l'officine
 * (`supplier_id`, `stock_minimum`, `reference_interne`, `localisation`,
 * `actif_localement`, `marge_libre`, `prix_achat`, `date_ajout`), et les
 * clés (`id`, `pharmacy_id`, `catalogue_produit_id`, horodatages).
 */
export const COPIED_COLUMNS = [
  // Identification
  "nom",
  "code_barres",
  "dosage",
  "categorie",
  "classe_therapeutique",
  "forme_galenique",
  "dci",
  "laboratoire",
  "produit_tableau",
  "gamme",
  "sous_gamme",
  "necessite_prescription",
  "produit_commercialise",
  "groupe_produits",
  "actif_catalogue",
  "refrigeration_requise",
  "conditionnement",
  "reference_labo",
  // Prix et fiscalité
  "pph",
  "ppv",
  "prix_base_remboursement",
  "tva_achat",
  "tva_vente",
  "remboursable",
  "taux_remboursement",
  // Descriptif
  "description",
  "excipients",
  "posologie_adulte",
  "posologie_enfant",
  "indications",
  "contre_indication_conduite",
  "contre_indication_allaitement",
  "contre_indication_grossesse",
  "monographie",
] as const;

/** Une ligne est « déjà recopiée » dès qu'elle porte un nom. */
const NOT_YET_COPIED = `s."nom" IS NULL`;

export function buildBackfillSql(): string {
  const assignments = COPIED_COLUMNS.map((column) => `"${column}" = c."${column}"`).join(",\n    ");
  return `
    UPDATE "pharmacy_stock" s
    SET ${assignments}
    FROM "catalogue_produits" c
    WHERE c."id" = s."catalogue_produit_id"
      AND ${NOT_YET_COPIED}
  `;
}

/** Compare colonne par colonne, en traitant NULL = NULL comme identique. */
export function buildComparisonSql(): string {
  const differences = COPIED_COLUMNS.map(
    (column) => `(s."${column}" IS DISTINCT FROM c."${column}")::int`,
  ).join(" + ");
  return `
    SELECT s."id",
           s."nom" AS stock_nom,
           c."nom" AS catalogue_nom,
           (${differences}) AS ecarts
    FROM "pharmacy_stock" s
    JOIN "catalogue_produits" c ON c."id" = s."catalogue_produit_id"
  `;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL est absent — vérifiez votre .env.");

  const target = (() => {
    try {
      const url = new URL(connectionString);
      return `${url.hostname}:${url.port || "5432"}`;
    } catch {
      return "(chaîne illisible)";
    }
  })();
  console.log(`Base cible : ${target}`);
  console.log(`Colonnes recopiées : ${COPIED_COLUMNS.length}\n`);

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const count = async (sql: string) => Number((await client.query(sql)).rows[0].n);

    const avant = await count(`SELECT count(*) n FROM "pharmacy_stock"`);
    const aRecopier = await count(
      `SELECT count(*) n FROM "pharmacy_stock" s WHERE ${NOT_YET_COPIED}`,
    );
    const orphelines = await count(`
      SELECT count(*) n FROM "pharmacy_stock" s
      WHERE NOT EXISTS (SELECT 1 FROM "catalogue_produits" c WHERE c."id" = s."catalogue_produit_id")
    `);

    console.log(`  lignes pharmacy_stock        ${avant}`);
    console.log(`  à recopier                   ${aRecopier}`);
    console.log(`  déjà recopiées               ${avant - aRecopier}`);
    if (orphelines > 0) {
      console.log(`  ⚠ sans fiche catalogue liée  ${orphelines} — laissées telles quelles`);
    }

    if (dryRun) {
      console.log("\n[dry-run] Rien n'a été écrit.");
      return;
    }

    // Tout ou rien : une recopie à moitié faite laisserait des lignes avec
    // un nom mais pas de prix, indistinguables des lignes complètes.
    await client.query("BEGIN");
    const result = await client.query(buildBackfillSql());
    await client.query("COMMIT");

    const apres = await count(`SELECT count(*) n FROM "pharmacy_stock"`);
    console.log(`\n  lignes recopiées             ${result.rowCount}`);
    console.log(`  lignes pharmacy_stock        ${avant} → ${apres}`);

    if (apres !== avant) {
      console.error("\n✖ Le nombre de lignes a changé — cela ne devrait jamais arriver.");
      process.exit(1);
    }

    // --- Contrôle : les valeurs recopiées correspondent-elles ? ---
    const { rows } = await client.query<{
      id: string;
      stock_nom: string | null;
      catalogue_nom: string;
      ecarts: number;
    }>(buildComparisonSql());

    const divergentes = rows.filter((row) => Number(row.ecarts) > 0);
    const nonRecopiees = rows.filter((row) => row.stock_nom === null);

    console.log(`\nContrôle sur ${rows.length} ligne(s) liée(s) à une fiche :`);
    console.log(`  identiques au catalogue      ${rows.length - divergentes.length}`);
    console.log(`  divergentes                  ${divergentes.length}`);

    if (nonRecopiees.length > 0) {
      console.error(`\n✖ ${nonRecopiees.length} ligne(s) toujours sans nom après recopie.`);
      process.exit(1);
    }

    if (divergentes.length > 0) {
      // Après un premier passage, zéro écart est attendu. Plus tard, une
      // divergence est NORMALE : c'est une officine qui a modifié sa copie.
      console.log("\n  Lignes divergentes (attendu si l'officine a modifié sa fiche) :");
      for (const row of divergentes.slice(0, 20)) {
        console.log(`    · ${row.stock_nom} — ${row.ecarts} champ(s) différent(s) du catalogue`);
      }
    } else {
      console.log("\n✓ Chaque ligne recopiée est identique à sa fiche catalogue.");
    }

    console.log(
      "\nÀ partir de maintenant les deux enregistrements sont indépendants :\n" +
        "modifier l'un n'affecte plus jamais l'autre.\n",
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("\nBackfill interrompu, rien n'a été écrit :\n", error);
  process.exit(1);
});
