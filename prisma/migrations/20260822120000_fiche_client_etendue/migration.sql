-- La fiche client s'étoffe : identité, adresse, tiers payant, plafond de
-- crédit. Tout est additif et nullable, sauf `type_client` qui porte une
-- valeur par défaut — aucune fiche existante ne change de comportement.
--
-- `cin` et `numero_immatriculation` ne figurent pas ici : ils ont été
-- ajoutés par 20260822000000_identifiants_bordereau, où ils servaient déjà
-- à identifier l'assuré sur un bordereau. Ils avaient en revanche disparu
-- du schéma Prisma, qui les redéclare maintenant.

CREATE TYPE "type_client" AS ENUM ('regulier', 'occasionnel', 'professionnel');

ALTER TABLE "clients"
    ADD COLUMN "email"            TEXT,
    ADD COLUMN "type_client"      "type_client" NOT NULL DEFAULT 'occasionnel',
    ADD COLUMN "medecin_traitant" TEXT,
    ADD COLUMN "adresse"          TEXT,
    ADD COLUMN "code_postal"      TEXT,
    ADD COLUMN "ville"            TEXT,
    ADD COLUMN "pays"             TEXT DEFAULT 'Maroc',
    ADD COLUMN "plafond_credit"   DECIMAL(12,2),
    ADD COLUMN "insurer_id"       TEXT;

-- SET NULL plutôt que CASCADE : un organisme qu'on cesse de reconnaître ne
-- doit pas emporter les fiches clients qui s'y rattachaient. En pratique un
-- organisme se désactive et ne se supprime pas, mais la suppression d'une
-- pharmacie passe bien par là.
ALTER TABLE "clients"
    ADD CONSTRAINT "clients_insurer_id_fkey"
    FOREIGN KEY ("insurer_id") REFERENCES "organismes_tiers_payant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "clients_insurer_id_idx" ON "clients"("insurer_id");
