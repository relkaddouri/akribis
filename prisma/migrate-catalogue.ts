/**
 * Répartit les produits existants entre les trois niveaux du PRD Catalogue
 * (sections 4 et 5) : catalogue national, stock officine, lots.
 *
 * Lancer avec :
 *   npm run migrate:catalogue
 *   npm run migrate:catalogue -- --dry-run   (n'écrit rien, affiche le plan)
 *
 * NE TOUCHE PAS à `products`, ni en lecture destructive ni en écriture. La
 * table reste la source de vérité du code applicatif tant que la phase
 * suivante n'a pas basculé les lectures — voir docs/migration-catalogue.md.
 *
 * Rejouable sans dommage. Chaque étape est idempotente :
 *   - le catalogue est dédoublonné sur le code-barres, identifiant national ;
 *   - `pharmacy_stock` porte un unique (pharmacy_id, catalogue_produit_id) ;
 *   - le lot issu de la migration porte un numéro sentinelle, cherché avant
 *     insertion.
 *
 * Pourquoi `pg` et du SQL brut plutôt que le client Prisma : ce script tourne
 * sur Node nu, qui résout l'ESM strictement, et le client généré importe ses
 * propres modules sans extension. Même raison que prisma/seed-publications.ts.
 */

import "dotenv/config";
import { Client } from "pg";

type ProductRow = {
  id: string;
  pharmacy_id: string;
  name: string;
  form: string;
  dosage: string | null;
  laboratory: string | null;
  barcode: string | null;
  dci: string | null;
  photo_url: string | null;
  category: string | null;
  price: string;
  purchase_price: string | null;
  pph: string | null;
  tva_vente: string | null;
  tva_achat: string | null;
  low_stock_threshold: number;
  quantity_in_stock: number;
  nearest_expiry_date: Date | null;
  remboursable: boolean;
  base_remboursement: string | null;
  posologie_enfant: string | null;
  posologie_adulte: string | null;
  monographie: string | null;
  created_at: Date;
};

/**
 * Marque les lots créés par cette migration. Le PRD précise qu'il n'existe
 * aucun historique de lots réels avant elle : plutôt qu'un numéro nul, cette
 * sentinelle dit d'où vient la ligne et rend le script rejouable.
 */
export const MIGRATION_LOT_NUMBER = "MIGRATION-INITIALE";

export type MigrationReport = {
  produits: number;
  catalogueCrees: number;
  catalogueReutilises: number;
  stockCrees: number;
  stockExistants: number;
  lotsCrees: number;
  lotsExistants: number;
  photosCreees: number;
  sansPeremption: number;
};

function emptyReport(): MigrationReport {
  return {
    produits: 0,
    catalogueCrees: 0,
    catalogueReutilises: 0,
    stockCrees: 0,
    stockExistants: 0,
    lotsCrees: 0,
    lotsExistants: 0,
    photosCreees: 0,
    sansPeremption: 0,
  };
}

/**
 * Répartition des colonnes de `products`, décidée d'après les sections 5.1 et
 * 5.2 du PRD :
 *
 *   - `category` porte aujourd'hui une classe thérapeutique (« Antibiotiques »),
 *     pas la catégorie du PRD (pharmaceutique / para / dispositif). Elle part
 *     donc dans `classe_therapeutique`, et `categorie` reste NULL : elle
 *     détermine le taux de TVA, une valeur inventée serait pire que rien.
 *   - `base_remboursement` est un MONTANT — il devient
 *     `prix_base_remboursement`, pas `taux_remboursement` qui est un
 *     pourcentage et reste inconnu.
 *   - `price` est le prix de vente pratiqué. Il alimente `ppv` faute de mieux,
 *     mais c'est une approximation : le PPV est réglementé et national, alors
 *     que ce prix a été saisi par une officine. Signalé dans la doc.
 *   - `purchase_price` et `low_stock_threshold` sont propres à l'officine et
 *     partent dans `pharmacy_stock`.
 */
const INSERT_CATALOGUE = `
  INSERT INTO catalogue_produits (
    id, nom, code_barres, dosage, classe_therapeutique,
    forme_galenique, dci, laboratoire, ppv, pph, tva_vente, tva_achat,
    remboursable, prix_base_remboursement, posologie_adulte, posologie_enfant,
    monographie, created_at, updated_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
    $17, $18, now()
  )
  RETURNING id
`;

/**
 * A fiche's photos live in their own table now, so `products.photo_url`
 * becomes the photo principale (ordre 0) rather than a column. Guarded on
 * the URL being present, and skipped when the fiche already carries it,
 * so a replay adds nothing.
 */
const INSERT_CATALOGUE_PHOTO = `
  INSERT INTO catalogue_produit_photos (id, catalogue_produit_id, url, ordre, date_ajout)
  SELECT gen_random_uuid(), $1, $2, 0, $3
  WHERE NOT EXISTS (
    SELECT 1 FROM catalogue_produit_photos WHERE catalogue_produit_id = $1 AND url = $2
  )
`;

const INSERT_STOCK = `
  INSERT INTO pharmacy_stock (
    id, pharmacy_id, catalogue_produit_id, stock_minimum, date_ajout,
    prix_achat, actif_localement, created_at, updated_at
  ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, true, $4, now())
  ON CONFLICT (pharmacy_id, catalogue_produit_id) DO NOTHING
  RETURNING id
`;

export async function migrateCatalogue(
  client: Client,
  options: { dryRun?: boolean } = {},
): Promise<MigrationReport> {
  const report = emptyReport();
  const { rows: products } = await client.query<ProductRow>(
    "SELECT * FROM products ORDER BY created_at ASC",
  );
  report.produits = products.length;

  for (const product of products) {
    // --- 1. Fiche catalogue, dédoublonnée sur le code-barres -------------
    // Deux officines vendant le même produit doivent partager UNE fiche :
    // c'est tout l'objet du PRD. Sans code-barres, aucun moyen fiable de
    // reconnaître le doublon — une fiche par produit, à fusionner
    // manuellement plus tard par l'Admin.
    let catalogueId: string | null = null;
    if (product.barcode) {
      const { rows } = await client.query<{ id: string }>(
        "SELECT id FROM catalogue_produits WHERE code_barres = $1",
        [product.barcode],
      );
      catalogueId = rows[0]?.id ?? null;
    }

    if (catalogueId) {
      report.catalogueReutilises += 1;
    } else if (!options.dryRun) {
      const { rows } = await client.query<{ id: string }>(INSERT_CATALOGUE, [
        // L'id du produit devient celui de la fiche catalogue : rejouer le
        // script retombe sur la même ligne, et le lien reste traçable.
        product.id,
        product.name,
        product.barcode,
        product.dosage,
        product.category,
        product.form,
        product.dci,
        product.laboratory,
        product.price,
        product.pph,
        product.tva_vente,
        product.tva_achat,
        product.remboursable,
        product.base_remboursement,
        product.posologie_adulte,
        product.posologie_enfant,
        product.monographie,
        product.created_at,
      ]);
      catalogueId = rows[0]!.id;
      report.catalogueCrees += 1;
    } else {
      catalogueId = product.id;
      report.catalogueCrees += 1;
    }

    // La photo du produit devient la photo principale de la fiche. Fait
    // aussi pour une fiche réutilisée : deux officines peuvent avoir
    // photographié le même produit, et la déduplication porte sur l'URL.
    if (!options.dryRun && product.photo_url?.trim()) {
      await client.query(INSERT_CATALOGUE_PHOTO, [
        catalogueId,
        product.photo_url.trim(),
        product.created_at,
      ]);
      report.photosCreees += 1;
    } else if (options.dryRun && product.photo_url?.trim()) {
      report.photosCreees += 1;
    }

    if (options.dryRun) {
      report.stockCrees += 1;
      report.lotsCrees += 1;
      if (!product.nearest_expiry_date) report.sansPeremption += 1;
      continue;
    }

    // --- 2. Ligne de stock officine --------------------------------------
    const { rows: created } = await client.query<{ id: string }>(INSERT_STOCK, [
      product.pharmacy_id,
      catalogueId,
      product.low_stock_threshold,
      product.created_at,
      product.purchase_price,
    ]);

    let stockId = created[0]?.id;
    if (stockId) {
      report.stockCrees += 1;
    } else {
      // ON CONFLICT DO NOTHING ne renvoie rien : la ligne existait déjà.
      const { rows } = await client.query<{ id: string }>(
        "SELECT id FROM pharmacy_stock WHERE pharmacy_id = $1 AND catalogue_produit_id = $2",
        [product.pharmacy_id, catalogueId],
      );
      stockId = rows[0]!.id;
      report.stockExistants += 1;
    }

    // --- 3. Lot unique ----------------------------------------------------
    // La date de péremption vivait sur le produit ; elle appartient au lot.
    // Un seul lot est créé, portant toute la quantité : l'historique réel des
    // réceptions n'existe pas avant cette migration.
    const { rows: existingLot } = await client.query<{ id: string }>(
      "SELECT id FROM product_lots WHERE pharmacy_stock_id = $1 AND numero_lot = $2",
      [stockId, MIGRATION_LOT_NUMBER],
    );

    if (existingLot.length > 0) {
      report.lotsExistants += 1;
    } else {
      await client.query(
        `INSERT INTO product_lots (
           id, pharmacy_stock_id, numero_lot, quantite, date_peremption,
           date_reception, created_at, updated_at
         ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $5, now())`,
        [
          stockId,
          MIGRATION_LOT_NUMBER,
          product.quantity_in_stock,
          product.nearest_expiry_date,
          product.created_at,
        ],
      );
      report.lotsCrees += 1;
    }

    if (!product.nearest_expiry_date) report.sansPeremption += 1;
  }

  return report;
}

function printReport(report: MigrationReport, dryRun: boolean) {
  const prefix = dryRun ? "[dry-run] " : "";
  console.log(`\n${prefix}Migration catalogue`);
  console.log(`  produits lus                 ${report.produits}`);
  console.log(`  fiches catalogue créées      ${report.catalogueCrees}`);
  console.log(`  fiches catalogue réutilisées ${report.catalogueReutilises}  (même code-barres)`);
  console.log(`  lignes de stock créées       ${report.stockCrees}`);
  console.log(`  lignes de stock déjà là      ${report.stockExistants}`);
  console.log(`  lots créés                   ${report.lotsCrees}`);
  console.log(`  lots déjà là                 ${report.lotsExistants}`);
  console.log(`  photos reprises              ${report.photosCreees}`);
  if (report.sansPeremption > 0) {
    console.log(
      `\n  ${report.sansPeremption} produit(s) sans date de péremption — lot créé sans date,`,
    );
    console.log("  à compléter à la première vraie réception.");
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL est absent — vérifiez votre fichier .env.");
  }

  const target = (() => {
    try {
      const url = new URL(connectionString);
      return `${url.hostname}:${url.port || "5432"}`;
    } catch {
      return "(chaîne illisible)";
    }
  })();
  console.log(`Base cible : ${target}`);

  const client = new Client({ connectionString });
  await client.connect();
  try {
    // Tout ou rien : une migration à moitié appliquée laisserait des lignes
    // de stock sans lot, donc des quantités à zéro.
    if (!dryRun) await client.query("BEGIN");
    const report = await migrateCatalogue(client, { dryRun });
    if (!dryRun) await client.query("COMMIT");
    printReport(report, dryRun);
  } catch (error) {
    if (!dryRun) await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("\nMigration interrompue, rien n'a été écrit :\n", error);
  process.exit(1);
});
