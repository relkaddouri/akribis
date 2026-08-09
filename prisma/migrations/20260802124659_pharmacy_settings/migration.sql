-- AlterTable
ALTER TABLE "pharmacies" ADD COLUMN     "ice" TEXT,
ADD COLUMN     "logo_url" TEXT,
ADD COLUMN     "order_number" TEXT,
ADD COLUMN     "receipt_settings" JSONB;
