-- AlterTable
ALTER TABLE "products" ADD COLUMN     "catalogue_produit_id" TEXT;

-- CreateIndex
CREATE INDEX "products_catalogue_produit_id_idx" ON "products"("catalogue_produit_id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_catalogue_produit_id_fkey" FOREIGN KEY ("catalogue_produit_id") REFERENCES "catalogue_produits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rattachement des produits existants à leur fiche catalogue.
--
-- Deux passes, de la plus sûre à la plus large :
--   1. la migration de phase 2 a créé chaque fiche avec l'id de son produit ;
--   2. sinon, le code-barres est l'identifiant national, donc une
--      correspondance exacte est fiable.
-- Ce qui ne correspond à rien reste NULL : un produit sans fiche catalogue
-- continue de fonctionner exactement comme avant.

UPDATE "products" p
SET "catalogue_produit_id" = c."id"
FROM "catalogue_produits" c
WHERE c."id" = p."id" AND p."catalogue_produit_id" IS NULL;

UPDATE "products" p
SET "catalogue_produit_id" = c."id"
FROM "catalogue_produits" c
WHERE p."catalogue_produit_id" IS NULL
  AND p."barcode" IS NOT NULL
  AND c."code_barres" = p."barcode";
