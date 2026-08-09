-- AlterEnum
ALTER TYPE "order_status" ADD VALUE 'PARTIALLY_RECEIVED';

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "received_quantity" INTEGER NOT NULL DEFAULT 0;
