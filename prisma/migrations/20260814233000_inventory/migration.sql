-- Inventory sessions and their per-product counts.
--
-- Purely additive: two new tables and one enum, no change to any existing
-- column, so this migration cannot disturb the stock or sales data already
-- in place.

CREATE TYPE "inventory_session_status" AS ENUM ('en_cours', 'termine');

CREATE TABLE "inventory_sessions" (
    "id" TEXT NOT NULL,
    "pharmacy_id" TEXT NOT NULL,
    "user_id" TEXT,
    "statut" "inventory_session_status" NOT NULL DEFAULT 'en_cours',
    "date_debut" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_fin" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_counts" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantite_theorique" INTEGER NOT NULL,
    "quantite_comptee" INTEGER,
    "date_comptage" TIMESTAMP(3),

    CONSTRAINT "inventory_counts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inventory_sessions_pharmacy_id_date_debut_idx" ON "inventory_sessions"("pharmacy_id", "date_debut");
CREATE INDEX "inventory_counts_session_id_idx" ON "inventory_counts"("session_id");
CREATE INDEX "inventory_counts_product_id_idx" ON "inventory_counts"("product_id");

-- One line per product per session: this is what turns a replayed count
-- into an update instead of a duplicate row.
CREATE UNIQUE INDEX "inventory_counts_session_id_product_id_key" ON "inventory_counts"("session_id", "product_id");

ALTER TABLE "inventory_sessions" ADD CONSTRAINT "inventory_sessions_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_sessions" ADD CONSTRAINT "inventory_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
