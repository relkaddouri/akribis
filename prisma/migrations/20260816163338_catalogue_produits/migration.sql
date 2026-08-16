-- CreateEnum
CREATE TYPE "produit_categorie" AS ENUM ('pharmaceutique', 'parapharmaceutique', 'dispositif_medical');

-- CreateEnum
CREATE TYPE "tableau_substance" AS ENUM ('aucun', 'a', 'b', 'c');

-- CreateTable
CREATE TABLE "catalogue_produits" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "code_barres" TEXT,
    "dosage" TEXT,
    "photo_url" TEXT,
    "categorie" "produit_categorie",
    "classe_therapeutique" TEXT,
    "forme_galenique" TEXT NOT NULL,
    "dci" TEXT,
    "laboratoire" TEXT,
    "produit_tableau" "tableau_substance" NOT NULL DEFAULT 'aucun',
    "gamme" TEXT,
    "sous_gamme" TEXT,
    "necessite_prescription" BOOLEAN NOT NULL DEFAULT false,
    "produit_commercialise" BOOLEAN NOT NULL DEFAULT true,
    "groupe_produits" TEXT,
    "actif_catalogue" BOOLEAN NOT NULL DEFAULT true,
    "refrigeration_requise" BOOLEAN NOT NULL DEFAULT false,
    "pph" DECIMAL(10,2),
    "ppv" DECIMAL(10,2),
    "prix_base_remboursement" DECIMAL(10,2),
    "tva_achat" DECIMAL(5,2),
    "tva_vente" DECIMAL(5,2),
    "remboursable" BOOLEAN NOT NULL DEFAULT false,
    "taux_remboursement" DECIMAL(5,2),
    "description" TEXT,
    "excipients" TEXT,
    "posologie_adulte" TEXT,
    "posologie_enfant" TEXT,
    "indications" TEXT,
    "contre_indication_conduite" TEXT,
    "contre_indication_allaitement" TEXT,
    "contre_indication_grossesse" TEXT,
    "reference_labo" TEXT,
    "conditionnement" TEXT,
    "monographie" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalogue_produits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_stock" (
    "id" TEXT NOT NULL,
    "pharmacy_id" TEXT NOT NULL,
    "catalogue_produit_id" TEXT NOT NULL,
    "supplier_id" TEXT,
    "stock_minimum" INTEGER NOT NULL DEFAULT 0,
    "stock_maximum" INTEGER,
    "date_ajout" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference_interne" TEXT,
    "localisation" TEXT,
    "actif_localement" BOOLEAN NOT NULL DEFAULT true,
    "marge_libre" DECIMAL(10,2),
    "prix_achat" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pharmacy_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_lots" (
    "id" TEXT NOT NULL,
    "pharmacy_stock_id" TEXT NOT NULL,
    "numero_lot" TEXT,
    "quantite" INTEGER NOT NULL DEFAULT 0,
    "date_peremption" TIMESTAMP(3),
    "date_reception" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_lots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "catalogue_produits_code_barres_key" ON "catalogue_produits"("code_barres");

-- CreateIndex
CREATE INDEX "catalogue_produits_nom_idx" ON "catalogue_produits"("nom");

-- CreateIndex
CREATE INDEX "catalogue_produits_dci_idx" ON "catalogue_produits"("dci");

-- CreateIndex
CREATE INDEX "catalogue_produits_laboratoire_idx" ON "catalogue_produits"("laboratoire");

-- CreateIndex
CREATE INDEX "pharmacy_stock_pharmacy_id_idx" ON "pharmacy_stock"("pharmacy_id");

-- CreateIndex
CREATE INDEX "pharmacy_stock_catalogue_produit_id_idx" ON "pharmacy_stock"("catalogue_produit_id");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_stock_pharmacy_id_catalogue_produit_id_key" ON "pharmacy_stock"("pharmacy_id", "catalogue_produit_id");

-- CreateIndex
CREATE INDEX "product_lots_pharmacy_stock_id_idx" ON "product_lots"("pharmacy_stock_id");

-- CreateIndex
CREATE INDEX "product_lots_date_peremption_idx" ON "product_lots"("date_peremption");

-- AddForeignKey
ALTER TABLE "pharmacy_stock" ADD CONSTRAINT "pharmacy_stock_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_stock" ADD CONSTRAINT "pharmacy_stock_catalogue_produit_id_fkey" FOREIGN KEY ("catalogue_produit_id") REFERENCES "catalogue_produits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_stock" ADD CONSTRAINT "pharmacy_stock_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_lots" ADD CONSTRAINT "product_lots_pharmacy_stock_id_fkey" FOREIGN KEY ("pharmacy_stock_id") REFERENCES "pharmacy_stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
