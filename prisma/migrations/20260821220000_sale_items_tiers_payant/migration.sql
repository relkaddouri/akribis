-- AlterTable
-- Additives. `base_remboursement` reste nullable : sur les ventes
-- antérieures il n'y a rien à figer, et un 0 se lirait comme « base nulle »
-- plutôt que comme « inconnue ». `montant_part_assurance` vaut 0, ce qui
-- est la vérité pour ces ventes-là — aucune n'a été partagée par ligne.
ALTER TABLE "sale_items"
    ADD COLUMN "base_remboursement" DECIMAL(10,2),
    ADD COLUMN "montant_part_assurance" DECIMAL(10,2) NOT NULL DEFAULT 0;
