-- Photos multiples pour une fiche catalogue.
--
-- L'ordre des trois étapes est délibéré : Prisma avait généré le
-- DROP COLUMN en premier, ce qui aurait effacé les photos existantes avant
-- d'avoir de quoi les recevoir. Ici la table est créée, les données sont
-- reprises, et la colonne n'est retirée qu'ensuite.

-- 1. La nouvelle table
CREATE TABLE "catalogue_produit_photos" (
    "id" TEXT NOT NULL,
    "catalogue_produit_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "date_ajout" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalogue_produit_photos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "catalogue_produit_photos_catalogue_produit_id_ordre_idx" ON "catalogue_produit_photos"("catalogue_produit_id", "ordre");

ALTER TABLE "catalogue_produit_photos" ADD CONSTRAINT "catalogue_produit_photos_catalogue_produit_id_fkey" FOREIGN KEY ("catalogue_produit_id") REFERENCES "catalogue_produits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Reprise de l'existant : la photo unique devient la photo principale.
-- `gen_random_uuid()` est disponible en natif depuis PostgreSQL 13.
INSERT INTO "catalogue_produit_photos" ("id", "catalogue_produit_id", "url", "ordre", "date_ajout")
SELECT gen_random_uuid(), "id", "photo_url", 0, COALESCE("created_at", now())
FROM "catalogue_produits"
WHERE "photo_url" IS NOT NULL AND btrim("photo_url") <> '';

-- 3. L'ancienne colonne, une fois son contenu à l'abri
ALTER TABLE "catalogue_produits" DROP COLUMN "photo_url";
