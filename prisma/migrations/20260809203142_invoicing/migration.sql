-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('issued', 'cancelled');

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "invoice_id" TEXT;

-- CreateTable
CREATE TABLE "invoice_counters" (
    "pharmacy_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("pharmacy_id","year")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "pharmacy_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "invoice_status" NOT NULL DEFAULT 'issued',
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pharmacy_name" TEXT NOT NULL,
    "pharmacy_address" TEXT,
    "pharmacy_phone" TEXT,
    "pharmacy_ice" TEXT,
    "client_id" TEXT,
    "client_name" TEXT,
    "total_ht" DECIMAL(12,2) NOT NULL,
    "total_tva" DECIMAL(12,2) NOT NULL,
    "total_ttc" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "product_id" TEXT,
    "designation" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_ht" DECIMAL(10,2) NOT NULL,
    "tva_rate" DECIMAL(5,2) NOT NULL,
    "total_ht" DECIMAL(12,2) NOT NULL,
    "total_tva" DECIMAL(12,2) NOT NULL,
    "total_ttc" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_pharmacy_id_issued_at_idx" ON "invoices"("pharmacy_id", "issued_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_pharmacy_id_number_key" ON "invoices"("pharmacy_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_pharmacy_id_year_sequence_key" ON "invoices"("pharmacy_id", "year", "sequence");

-- CreateIndex
CREATE INDEX "invoice_lines_invoice_id_idx" ON "invoice_lines"("invoice_id");

-- CreateIndex
CREATE INDEX "sales_invoice_id_idx" ON "sales"("invoice_id");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
