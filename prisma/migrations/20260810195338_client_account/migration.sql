-- CreateEnum
CREATE TYPE "client_transaction_type" AS ENUM ('vente', 'paiement_partiel', 'avoir_recu', 'ajustement');

-- CreateEnum
CREATE TYPE "reminder_status" AS ENUM ('a_faire', 'fait', 'annule');

-- AlterEnum
ALTER TYPE "payment_method" ADD VALUE 'credit';

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "points_fidelite" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "solde" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "pharmacies" ADD COLUMN     "loyalty_rate" DECIMAL(10,2) NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "client_transactions" (
    "id" TEXT NOT NULL,
    "pharmacy_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "type" "client_transaction_type" NOT NULL,
    "montant" DECIMAL(12,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sale_id" TEXT,
    "description" TEXT,

    CONSTRAINT "client_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_reminders" (
    "id" TEXT NOT NULL,
    "pharmacy_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "product_id" TEXT,
    "date_rappel" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL,
    "statut" "reminder_status" NOT NULL DEFAULT 'a_faire',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_transactions_client_id_date_idx" ON "client_transactions"("client_id", "date");

-- CreateIndex
CREATE INDEX "client_transactions_pharmacy_id_idx" ON "client_transactions"("pharmacy_id");

-- CreateIndex
CREATE INDEX "client_transactions_sale_id_idx" ON "client_transactions"("sale_id");

-- CreateIndex
CREATE INDEX "client_reminders_pharmacy_id_date_rappel_idx" ON "client_reminders"("pharmacy_id", "date_rappel");

-- CreateIndex
CREATE INDEX "client_reminders_client_id_idx" ON "client_reminders"("client_id");

-- AddForeignKey
ALTER TABLE "client_transactions" ADD CONSTRAINT "client_transactions_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_transactions" ADD CONSTRAINT "client_transactions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_transactions" ADD CONSTRAINT "client_transactions_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_reminders" ADD CONSTRAINT "client_reminders_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_reminders" ADD CONSTRAINT "client_reminders_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_reminders" ADD CONSTRAINT "client_reminders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
