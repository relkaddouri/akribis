-- Order / delivery / supplier-credit lifecycle.
--
-- Hand-written rather than generated: `orders` already holds rows, so the
-- status enum is remapped in place and `numero` is backfilled before being
-- made NOT NULL. Nothing is dropped that carries data.

-- ── orders: column renames and new fields ────────────────────────────────
ALTER TABLE "orders" RENAME COLUMN "created_at" TO "date_creation";
ALTER TABLE "orders" ADD COLUMN "date_envoi" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "numero" INTEGER;

-- ── orders.status: new value set, existing rows mapped across ────────────
-- PENDING becomes 'envoyee': an order created in the app has already been
-- placed with the supplier — there is no draft flow today. CANCELLED holds
-- no rows (verified before writing this) but is mapped to 'cloturee' rather
-- than dropped blindly, so the statement stays safe if one appears.
CREATE TYPE "order_status_new" AS ENUM (
  'brouillon', 'envoyee', 'partiellement_recue', 'recue', 'cloturee'
);

ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "orders"
  ALTER COLUMN "status" TYPE "order_status_new"
  USING (
    CASE "status"::text
      WHEN 'PENDING'            THEN 'envoyee'
      WHEN 'PARTIALLY_RECEIVED' THEN 'partiellement_recue'
      WHEN 'RECEIVED'           THEN 'recue'
      WHEN 'CANCELLED'          THEN 'cloturee'
      ELSE 'brouillon'
    END
  )::"order_status_new";

DROP TYPE "order_status";
ALTER TYPE "order_status_new" RENAME TO "order_status";
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'brouillon';

-- Orders that already existed were placed, so give them a send date.
UPDATE "orders" SET "date_envoi" = "date_creation" WHERE "date_envoi" IS NULL;

-- ── Backfill orders.numero, oldest first, per pharmacy ───────────────────
WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "pharmacy_id" ORDER BY "date_creation", "id"
  ) AS rn
  FROM "orders"
)
UPDATE "orders" o SET "numero" = n.rn FROM numbered n WHERE o."id" = n."id";

ALTER TABLE "orders" ALTER COLUMN "numero" SET NOT NULL;
CREATE UNIQUE INDEX "orders_pharmacy_id_numero_key" ON "orders"("pharmacy_id", "numero");

-- ── Document counters, seeded so numbering continues, never repeats ──────
CREATE TABLE "document_counters" (
  "pharmacy_id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "last_sequence" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "document_counters_pkey" PRIMARY KEY ("pharmacy_id", "scope")
);

INSERT INTO "document_counters" ("pharmacy_id", "scope", "last_sequence")
SELECT "pharmacy_id", 'order', MAX("numero") FROM "orders" GROUP BY "pharmacy_id";

-- ── deliveries ───────────────────────────────────────────────────────────
CREATE TABLE "deliveries" (
  "id" TEXT NOT NULL,
  "pharmacy_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "numero" INTEGER NOT NULL,
  "date_reception" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "deliveries_pharmacy_id_numero_key" ON "deliveries"("pharmacy_id", "numero");
CREATE INDEX "deliveries_order_id_idx" ON "deliveries"("order_id");
CREATE INDEX "deliveries_pharmacy_id_date_reception_idx" ON "deliveries"("pharmacy_id", "date_reception");

CREATE TABLE "delivery_items" (
  "id" TEXT NOT NULL,
  "delivery_id" TEXT NOT NULL,
  "order_item_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "quantite_recue" INTEGER NOT NULL,
  CONSTRAINT "delivery_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "delivery_items_delivery_id_idx" ON "delivery_items"("delivery_id");
CREATE INDEX "delivery_items_order_item_id_idx" ON "delivery_items"("order_item_id");
CREATE INDEX "delivery_items_product_id_idx" ON "delivery_items"("product_id");

-- ── supplier credits ─────────────────────────────────────────────────────
CREATE TYPE "supplier_credit_status" AS ENUM ('emis', 'recu');
CREATE TYPE "supplier_credit_motif" AS ENUM (
  'produit_endommage', 'produit_perime', 'rappel_lot',
  'erreur_livraison', 'erreur_prix', 'remise', 'autre'
);
CREATE TYPE "supplier_credit_compensation" AS ENUM ('avoir_credit', 'especes');

CREATE TABLE "supplier_credits" (
  "id" TEXT NOT NULL,
  "pharmacy_id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "order_id" TEXT,
  "numero" INTEGER NOT NULL,
  "statut" "supplier_credit_status" NOT NULL DEFAULT 'emis',
  "motif" "supplier_credit_motif" NOT NULL,
  "mode_compensation" "supplier_credit_compensation",
  "montant" DECIMAL(12,2) NOT NULL,
  "date_emission" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_reception" TIMESTAMP(3),
  "lie_rappel_lot" BOOLEAN NOT NULL DEFAULT false,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_credits_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "supplier_credits_pharmacy_id_numero_key" ON "supplier_credits"("pharmacy_id", "numero");
CREATE INDEX "supplier_credits_pharmacy_id_date_emission_idx" ON "supplier_credits"("pharmacy_id", "date_emission");
CREATE INDEX "supplier_credits_supplier_id_idx" ON "supplier_credits"("supplier_id");
CREATE INDEX "supplier_credits_order_id_idx" ON "supplier_credits"("order_id");

CREATE TABLE "supplier_credit_items" (
  "id" TEXT NOT NULL,
  "credit_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "quantite" INTEGER NOT NULL,
  "unit_price" DECIMAL(10,2) NOT NULL,
  CONSTRAINT "supplier_credit_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "supplier_credit_items_credit_id_idx" ON "supplier_credit_items"("credit_id");
CREATE INDEX "supplier_credit_items_product_id_idx" ON "supplier_credit_items"("product_id");

-- ── foreign keys ─────────────────────────────────────────────────────────
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_pharmacy_id_fkey"
  FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_delivery_id_fkey"
  FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_order_item_id_fkey"
  FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_pharmacy_id_fkey"
  FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_credit_items" ADD CONSTRAINT "supplier_credit_items_credit_id_fkey"
  FOREIGN KEY ("credit_id") REFERENCES "supplier_credits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_credit_items" ADD CONSTRAINT "supplier_credit_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
