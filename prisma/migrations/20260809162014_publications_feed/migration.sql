-- CreateEnum
CREATE TYPE "publication_type" AS ENUM ('nouveaute', 'alerte', 'maintenance', 'annonce_suite');

-- CreateEnum
CREATE TYPE "niveau_urgence" AS ENUM ('faible', 'moyenne', 'elevee');

-- CreateEnum
CREATE TYPE "outil_akribis" AS ENUM ('intelligence', 'labo', 'medical', 'suite');

-- CreateTable
CREATE TABLE "publications" (
    "id" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "contenu" TEXT NOT NULL,
    "type" "publication_type" NOT NULL,
    "niveau_urgence" "niveau_urgence",
    "outil_associe" "outil_akribis",
    "image_url" TEXT,
    "date_publication" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auteur" TEXT NOT NULL DEFAULT 'Équipe Akribis',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_lectures" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "publication_id" TEXT NOT NULL,
    "lu_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publication_lectures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "publications_date_publication_idx" ON "publications"("date_publication");

-- CreateIndex
CREATE INDEX "publication_lectures_user_id_idx" ON "publication_lectures"("user_id");

-- CreateIndex
CREATE INDEX "publication_lectures_publication_id_idx" ON "publication_lectures"("publication_id");

-- CreateIndex
CREATE UNIQUE INDEX "publication_lectures_user_id_publication_id_key" ON "publication_lectures"("user_id", "publication_id");

-- AddForeignKey
ALTER TABLE "publication_lectures" ADD CONSTRAINT "publication_lectures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_lectures" ADD CONSTRAINT "publication_lectures_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
