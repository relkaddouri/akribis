-- AlterTable
ALTER TABLE "catalogue_produits" ADD COLUMN     "categorie_principale" TEXT,
ADD COLUMN     "etiquettes" TEXT,
ADD COLUMN     "marque" TEXT,
ADD COLUMN     "prix_vente_indicatif" DECIMAL(10,2),
ADD COLUMN     "sous_categorie" TEXT,
ADD COLUMN     "sous_sous_categorie" TEXT;
