-- CreateEnum
CREATE TYPE "statut_bordereau" AS ENUM ('brouillon', 'envoye', 'en_traitement', 'cloture');
CREATE TYPE "statut_ligne_bordereau" AS ENUM ('en_attente', 'acceptee', 'rejetee');

-- CreateTable
CREATE TABLE "bordereaux" (
    "id" TEXT NOT NULL,
    "pharmacy_id" TEXT NOT NULL,
    "insurer_id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "periode_debut" DATE NOT NULL,
    "periode_fin" DATE NOT NULL,
    "statut" "statut_bordereau" NOT NULL DEFAULT 'brouillon',
    "montant_recu" DECIMAL(10,2),
    "date_rapprochement" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bordereaux_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bordereau_ventes" (
    "id" TEXT NOT NULL,
    "bordereau_id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "montant_reclame" DECIMAL(10,2) NOT NULL,
    "statut" "statut_ligne_bordereau" NOT NULL DEFAULT 'en_attente',
    "motif_rejet" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bordereau_ventes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bordereaux_pharmacy_id_numero_key" ON "bordereaux"("pharmacy_id", "numero");
CREATE INDEX "bordereaux_pharmacy_id_statut_idx" ON "bordereaux"("pharmacy_id", "statut");
CREATE INDEX "bordereaux_insurer_id_idx" ON "bordereaux"("insurer_id");
CREATE UNIQUE INDEX "bordereau_ventes_bordereau_id_sale_id_key"
    ON "bordereau_ventes"("bordereau_id", "sale_id");
CREATE INDEX "bordereau_ventes_sale_id_idx" ON "bordereau_ventes"("sale_id");

-- Une vente n'appartient qu'à UN bordereau actif.
--
-- Index unique PARTIEL : la contrainte ne porte que sur les lignes non
-- rejetées. C'est exactement la règle métier — une vente rejetée par
-- l'organisme repasse en attente et doit pouvoir entrer dans un bordereau
-- suivant après correction, tandis qu'une vente déjà réclamée ailleurs ne
-- doit jamais l'être deux fois.
--
-- En base et non dans le code : le statut de la vente (`en_attente_bordereau`)
-- filtre déjà les candidates côté application, mais deux créations
-- concurrentes peuvent lire ce statut au même instant. Seul l'index les
-- départage.
CREATE UNIQUE INDEX "bordereau_ventes_sale_actif_key"
    ON "bordereau_ventes"("sale_id")
    WHERE "statut" <> 'rejetee';

-- AddForeignKey
ALTER TABLE "bordereaux" ADD CONSTRAINT "bordereaux_pharmacy_id_fkey"
    FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bordereaux" ADD CONSTRAINT "bordereaux_insurer_id_fkey"
    FOREIGN KEY ("insurer_id") REFERENCES "organismes_tiers_payant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bordereau_ventes" ADD CONSTRAINT "bordereau_ventes_bordereau_id_fkey"
    FOREIGN KEY ("bordereau_id") REFERENCES "bordereaux"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bordereau_ventes" ADD CONSTRAINT "bordereau_ventes_sale_id_fkey"
    FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
