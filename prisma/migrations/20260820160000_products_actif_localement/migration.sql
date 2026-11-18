-- AlterTable
-- Additive : DEFAULT true, donc chaque produit existant reste actif et
-- aucun écran ne change de comportement tant que personne ne bascule
-- l'interrupteur.
ALTER TABLE "products" ADD COLUMN     "actif_localement" BOOLEAN NOT NULL DEFAULT true;
