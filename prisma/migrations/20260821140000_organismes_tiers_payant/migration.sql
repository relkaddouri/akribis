-- AlterTable
-- Additive et nullable : aucune officine existante n'a d'INPE saisi, et
-- rien ne doit changer tant que personne ne le renseigne.
ALTER TABLE "pharmacies" ADD COLUMN "inpe" TEXT;

-- CreateTable
CREATE TABLE "organismes_tiers_payant" (
    "id" TEXT NOT NULL,
    "pharmacy_id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "taux_couverture" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "format_bordereau" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organismes_tiers_payant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Le code identifie l'organisme sur les bordereaux : deux lignes du même
-- code dans une officine rendraient le rapprochement impossible. L'unicité
-- vaut PAR officine — « CNOPS » existe chez toutes.
CREATE UNIQUE INDEX "organismes_tiers_payant_pharmacy_id_code_key"
    ON "organismes_tiers_payant"("pharmacy_id", "code");
CREATE INDEX "organismes_tiers_payant_pharmacy_id_actif_idx"
    ON "organismes_tiers_payant"("pharmacy_id", "actif");

-- AddForeignKey
ALTER TABLE "organismes_tiers_payant"
    ADD CONSTRAINT "organismes_tiers_payant_pharmacy_id_fkey"
    FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
