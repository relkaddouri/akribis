-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('cash', 'card');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "price" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "payment_method" "payment_method" NOT NULL DEFAULT 'cash';
