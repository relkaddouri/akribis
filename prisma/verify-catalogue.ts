/**
 * Contrôle d'après-migration : compare `products` aux trois nouvelles tables
 * et signale tout écart.
 *
 * Lancer avec :
 *   npm run verify:catalogue
 *
 * Strictement en lecture. Sort en code 1 si un écart est trouvé, pour qu'un
 * enchaînement de commandes s'arrête plutôt que de continuer sur une
 * migration incomplète.
 */

import "dotenv/config";
import { Client } from "pg";

export type Anomalie = {
  gravite: "bloquant" | "attention";
  message: string;
};

export type Controle = {
  produits: number;
  cataloguesReferences: number;
  lignesStock: number;
  lots: number;
  quantiteProduits: number;
  quantiteLots: number;
  anomalies: Anomalie[];
};

/**
 * Les quatre questions auxquelles ce contrôle répond :
 *   1. chaque produit a-t-il une ligne de stock ?
 *   2. chaque ligne de stock a-t-elle au moins un lot ?
 *   3. la quantité totale est-elle conservée ?
 *   4. reste-t-il des lignes orphelines ou en double ?
 */
export async function verifyCatalogue(client: Client): Promise<Controle> {
  const anomalies: Anomalie[] = [];
  const one = async (sql: string) => Number((await client.query(sql)).rows[0].n);

  const produits = await one("SELECT count(*) n FROM products");
  const lignesStock = await one("SELECT count(*) n FROM pharmacy_stock");
  const lots = await one("SELECT count(*) n FROM product_lots");
  const cataloguesReferences = await one(
    "SELECT count(DISTINCT catalogue_produit_id) n FROM pharmacy_stock",
  );
  const quantiteProduits = await one(
    "SELECT coalesce(sum(quantity_in_stock), 0) n FROM products",
  );
  const quantiteLots = await one("SELECT coalesce(sum(quantite), 0) n FROM product_lots");

  // 1. Produits sans ligne de stock. La jointure passe par le couple
  // (pharmacie, code-barres) quand il existe, sinon par l'id — que la
  // migration réutilise comme id de fiche catalogue.
  const { rows: nonMigres } = await client.query<{ id: string; name: string }>(`
    SELECT p.id, p.name
    FROM products p
    WHERE NOT EXISTS (
      SELECT 1
      FROM pharmacy_stock s
      JOIN catalogue_produits c ON c.id = s.catalogue_produit_id
      WHERE s.pharmacy_id = p.pharmacy_id
        AND (
          (p.barcode IS NOT NULL AND c.code_barres = p.barcode)
          OR c.id = p.id
        )
    )
  `);
  for (const row of nonMigres) {
    anomalies.push({
      gravite: "bloquant",
      message: `Produit non migré : « ${row.name} » (${row.id}) n'a aucune ligne de stock.`,
    });
  }

  // 2. Lignes de stock sans lot : la quantité y serait nulle, le produit
  // paraîtrait en rupture.
  const sansLot = await one(`
    SELECT count(*) n FROM pharmacy_stock s
    WHERE NOT EXISTS (SELECT 1 FROM product_lots l WHERE l.pharmacy_stock_id = s.id)
  `);
  if (sansLot > 0) {
    anomalies.push({
      gravite: "bloquant",
      message: `${sansLot} ligne(s) de stock sans aucun lot — la quantité y sera nulle.`,
    });
  }

  // 3. Conservation des quantités. Le total des lots doit égaler le total
  // des produits : c'est la seule vérification qui prouve qu'aucune unité
  // n'a été perdue en route.
  if (quantiteProduits !== quantiteLots) {
    anomalies.push({
      gravite: "bloquant",
      message:
        `Quantité totale différente : ${quantiteProduits} dans products, ` +
        `${quantiteLots} dans product_lots (écart de ${quantiteLots - quantiteProduits}).`,
    });
  }

  // 4. Doublons de catalogue : deux fiches pour un même code-barres videraient
  // le PRD de son sens. L'index unique l'interdit, mais le vérifier coûte peu
  // et couvre une insertion faite à la main.
  const doublons = await one(`
    SELECT count(*) n FROM (
      SELECT code_barres FROM catalogue_produits
      WHERE code_barres IS NOT NULL
      GROUP BY code_barres HAVING count(*) > 1
    ) d
  `);
  if (doublons > 0) {
    anomalies.push({
      gravite: "bloquant",
      message: `${doublons} code(s)-barres présent(s) sur plusieurs fiches catalogue.`,
    });
  }

  // Signalements non bloquants : la migration est correcte, mais des données
  // restent à compléter par l'Admin.
  const sansCategorie = await one(
    "SELECT count(*) n FROM catalogue_produits WHERE categorie IS NULL",
  );
  if (sansCategorie > 0) {
    anomalies.push({
      gravite: "attention",
      message:
        `${sansCategorie} fiche(s) catalogue sans catégorie (pharmaceutique / para / ` +
        "dispositif) — l'information n'existait pas dans products, et elle détermine la TVA.",
    });
  }

  const sansCodeBarres = await one(
    "SELECT count(*) n FROM catalogue_produits WHERE code_barres IS NULL",
  );
  if (sansCodeBarres > 0) {
    anomalies.push({
      gravite: "attention",
      message:
        `${sansCodeBarres} fiche(s) catalogue sans code-barres — non dédoublonnables ` +
        "automatiquement, à fusionner à la main si plusieurs officines saisissent le même produit.",
    });
  }

  const sansPeremption = await one(
    "SELECT count(*) n FROM product_lots WHERE date_peremption IS NULL",
  );
  if (sansPeremption > 0) {
    anomalies.push({
      gravite: "attention",
      message: `${sansPeremption} lot(s) sans date de péremption — exclus des alertes FEFO.`,
    });
  }

  return {
    produits,
    cataloguesReferences,
    lignesStock,
    lots,
    quantiteProduits,
    quantiteLots,
    anomalies,
  };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL est absent — vérifiez votre fichier .env.");
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const controle = await verifyCatalogue(client);

    console.log("\nContrôle de la migration catalogue\n");
    console.log(`  products                      ${controle.produits}`);
    console.log(`  pharmacy_stock                ${controle.lignesStock}`);
    console.log(`  catalogue_produits référencés ${controle.cataloguesReferences}`);
    console.log(`  product_lots                  ${controle.lots}`);
    console.log(
      `  quantité totale               ${controle.quantiteProduits} → ${controle.quantiteLots}`,
    );

    const bloquants = controle.anomalies.filter((a) => a.gravite === "bloquant");
    const attentions = controle.anomalies.filter((a) => a.gravite === "attention");

    if (attentions.length > 0) {
      console.log("\n  À compléter :");
      for (const a of attentions) console.log(`    · ${a.message}`);
    }

    if (bloquants.length === 0) {
      console.log("\n✓ Aucune incohérence. Chaque produit a son stock, chaque stock son lot,");
      console.log("  et les quantités sont conservées.\n");
      return;
    }

    console.log("\n✖ Incohérences :");
    for (const a of bloquants) console.log(`    · ${a.message}`);
    console.log("");
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("\nContrôle interrompu :\n", error);
  process.exit(1);
});
