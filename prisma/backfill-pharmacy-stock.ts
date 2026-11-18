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
  "prix_vente_indicatif",
  "marque",
  "categorie_principale",
  "sous_categorie",
  "sous_sous_categorie",
  "etiquettes",
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

/**
 * Colonnes que le rattrapage remplit là où la copie est restée vide.
 *
 * La passe principale ne touche que les lignes vierges (`nom IS NULL`),
 * pour ne jamais écraser une correction de l'officine. Une case peut donc
 * rester vide pour toujours, pour deux raisons différentes :
 *
 *   - la colonne a été **ajoutée après** que la ligne ait été recopiée —
 *     la ligne porte un nom, donc elle est « déjà faite », alors que cette
 *     colonne-là n'a jamais rien reçu (`prix_vente_indicatif`) ;
 *   - la colonne existait, mais **le catalogue n'avait pas encore la
 *     valeur** au moment de la copie (`categorie`, restée NULL jusqu'à ce
 *     que `categorize:catalogue` classe les 5 916 fiches CNOPS).
 *
 * Dans les deux cas la règle est la même, et c'est elle qui rend
 * l'opération sûre : on ne remplit **que là où la valeur est encore
 * NULL**, et seulement si le catalogue en a une. Un NULL ici ne peut pas
 * être un choix de la pharmacie — elle n'a aucun moyen de vider ces
 * champs depuis l'interface.
 *
 * À compléter à chaque nouveau cas — le test tests/db/backfill-colonnes.ts
 * vérifie que ces colonnes figurent aussi dans COPIED_COLUMNS.
 */
export const COLONNES_A_RATTRAPER = [
  "prix_vente_indicatif",
  "categorie",
  "marque",
  "categorie_principale",
  "sous_categorie",
  "sous_sous_categorie",
  "etiquettes",
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

/**
 * Rattrapage d'une colonne tardive : on ne remplit que les cases vides, et
 * seulement quand le catalogue a bien quelque chose à y mettre.
 */
export function buildTopUpSql(column: string): string {
  return `
    UPDATE "pharmacy_stock" s
    SET "${column}" = c."${column}"
    FROM "catalogue_produits" c
    WHERE c."id" = s."catalogue_produit_id"
      AND s."${column}" IS NULL
      AND c."${column}" IS NOT NULL
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

    // Ce que le rattrapage remplirait : compté aussi en dry-run, sinon
    // celui-ci annoncerait « rien à faire » alors que l'exécution réelle
    // écrirait — le contraire de ce à quoi sert un dry-run.
    let aRattraper = 0;
    for (const column of COLONNES_A_RATTRAPER) {
      const n = await count(`
        SELECT count(*) n FROM "pharmacy_stock" s
        JOIN "catalogue_produits" c ON c."id" = s."catalogue_produit_id"
        WHERE s."${column}" IS NULL AND c."${column}" IS NOT NULL
      `);
      if (n > 0) console.log(`  à rattraper ${column.padEnd(21)} ${n} ligne(s)`);
      aRattraper += n;
    }
    if (aRattraper === 0) console.log("  à rattraper                  0");

    if (dryRun) {
      console.log("\n[dry-run] Rien n'a été écrit.");
      return;
    }

    // Tout ou rien : une recopie à moitié faite laisserait des lignes avec
    // un nom mais pas de prix, indistinguables des lignes complètes.
    await client.query("BEGIN");
    const result = await client.query(buildBackfillSql());
    await client.query("COMMIT");

    // Rattrapage des colonnes tardives, sur les lignes déjà recopiées.
    let rattrapees = 0;
    for (const column of COLONNES_A_RATTRAPER) {
      const top = await client.query(buildTopUpSql(column));
      if (top.rowCount) {
        console.log(`  rattrapage ${column.padEnd(22)} ${top.rowCount} ligne(s)`);
        rattrapees += top.rowCount;
      }
    }

    const apres = await count(`SELECT count(*) n FROM "pharmacy_stock"`);
    console.log(`\n  lignes recopiées             ${result.rowCount}`);
    console.log(`  cases rattrapées             ${rattrapees}`);
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
