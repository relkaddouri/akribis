-- L'identifiant fiscal (IF) de l'officine, et sa recopie sur chaque facture.
--
-- Sur `invoices` c'est un instantané, au même titre que `pharmacy_ice` et les
-- autres coordonnées déjà recopiées là : le QR code d'une facture doit
-- continuer d'encoder l'IF qui était celui de l'officine le jour de
-- l'émission, même si la pharmacie en change ensuite.
--
-- Nullable dans les deux cas : les factures déjà émises n'en ont pas, et
-- rien ne doit les rendre invalides rétroactivement.
ALTER TABLE "pharmacies" ADD COLUMN "identifiant_fiscal" TEXT;
ALTER TABLE "invoices" ADD COLUMN "pharmacy_identifiant_fiscal" TEXT;
