-- AlterTable
ALTER TABLE "products" ADD COLUMN     "base_remboursement" DECIMAL(10,2),
ADD COLUMN     "category" TEXT,
ADD COLUMN     "monographie" TEXT,
ADD COLUMN     "photo_url" TEXT,
ADD COLUMN     "posologie_adulte" TEXT,
ADD COLUMN     "posologie_enfant" TEXT,
ADD COLUMN     "pph" DECIMAL(10,2),
ADD COLUMN     "remboursable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tva_achat" DECIMAL(5,2),
ADD COLUMN     "tva_vente" DECIMAL(5,2);
