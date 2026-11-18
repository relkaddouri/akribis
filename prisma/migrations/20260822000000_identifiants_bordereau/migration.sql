-- AlterTable
-- Additifs et nullables : aucune officine ni aucun client n'a ces valeurs
-- aujourd'hui, et rien ne doit changer tant que personne ne les saisit.
-- Ils n'existent que pour être imprimés sur un bordereau, où l'organisme
-- s'en sert pour identifier la pharmacie et l'assuré.
ALTER TABLE "pharmacies" ADD COLUMN "patente" TEXT;
ALTER TABLE "clients"
    ADD COLUMN "numero_immatriculation" TEXT,
    ADD COLUMN "cin" TEXT;
