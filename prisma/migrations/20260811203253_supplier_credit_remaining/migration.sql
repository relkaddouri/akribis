-- Remaining balance on a supplier credit, so one credit can't be applied to
-- two different orders.
--
-- Backfilled to the full amount for every existing credit: none has been
-- consumed yet, since consumption is introduced by this same change.
ALTER TABLE "supplier_credits" ADD COLUMN "montant_restant" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "supplier_credits" SET "montant_restant" = "montant";
