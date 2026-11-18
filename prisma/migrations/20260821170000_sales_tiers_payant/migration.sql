-- CreateEnum
CREATE TYPE "statut_creance" AS ENUM (
    'aucune', 'en_attente_bordereau', 'dans_bordereau', 'acceptee', 'rejetee', 'payee'
);

-- AlterTable
ALTER TABLE "sales"
    ADD COLUMN "insurer_id" TEXT,
    ADD COLUMN "montant_part_client" DECIMAL(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN "montant_part_assurance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN "statut_creance" "statut_creance" NOT NULL DEFAULT 'aucune';

-- Rattrapage des ventes antérieures.
--
-- Le DEFAULT 0 les laisserait avec une part client nulle sur un total non
-- nul : l'invariant `part_client + part_assurance = total` serait faux dès
-- la première ligne existante, et le test qui le vérifie n'aurait plus
-- rien à protéger. Sans organisme, tout est à la charge du client.
UPDATE "sales" SET "montant_part_client" = "total_amount";

-- CreateIndex
CREATE INDEX "sales_pharmacy_id_statut_creance_idx" ON "sales"("pharmacy_id", "statut_creance");

-- AddForeignKey
-- SET NULL et non CASCADE : un organisme désactivé puis supprimé un jour
-- ne doit pas emporter les ventes qui le référencent.
ALTER TABLE "sales"
    ADD CONSTRAINT "sales_insurer_id_fkey"
    FOREIGN KEY ("insurer_id") REFERENCES "organismes_tiers_payant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
