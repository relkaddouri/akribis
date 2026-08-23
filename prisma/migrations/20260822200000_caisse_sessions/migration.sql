-- Le cycle d'ouverture et de clôture de caisse (Journal Z).

CREATE TYPE "statut_caisse_session" AS ENUM ('ouverte', 'cloturee');

CREATE TABLE "caisse_sessions" (
    "id"                  TEXT NOT NULL,
    "pharmacy_id"         TEXT NOT NULL,
    "ouverte_par"         TEXT NOT NULL,
    "fond_caisse_initial" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "date_ouverture"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statut"              "statut_caisse_session" NOT NULL DEFAULT 'ouverte',
    "fermee_par"          TEXT,
    "date_fermeture"      TIMESTAMP(3),
    "especes_theoriques"  DECIMAL(10,2),
    "especes_reelles"     DECIMAL(10,2),
    "ecart_caisse"        DECIMAL(10,2),
    "numero_z"            TEXT,
    "fermeture_par_pin"   BOOLEAN NOT NULL DEFAULT false,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "caisse_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "caisse_sessions_pharmacy_id_numero_z_key"
    ON "caisse_sessions"("pharmacy_id", "numero_z");
CREATE INDEX "caisse_sessions_pharmacy_id_statut_idx"
    ON "caisse_sessions"("pharmacy_id", "statut");
CREATE INDEX "caisse_sessions_pharmacy_id_date_ouverture_idx"
    ON "caisse_sessions"("pharmacy_id", "date_ouverture");

ALTER TABLE "caisse_sessions"
    ADD CONSTRAINT "caisse_sessions_pharmacy_id_fkey"
    FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- RESTRICT sur l'ouvreur : supprimer le compte de qui a ouvert la caisse
    -- effacerait la réponse à « qui a démarré cette journée ».
    ADD CONSTRAINT "caisse_sessions_ouverte_par_fkey"
    FOREIGN KEY ("ouverte_par") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "caisse_sessions_fermee_par_fkey"
    FOREIGN KEY ("fermee_par") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Une seule session ouverte à la fois par officine. Index partiel, comme
-- pour l'appartenance des ventes à un bordereau : Prisma ne sait pas
-- l'exprimer, il vit donc ici. Sans lui, deux onglets ouverts le matin
-- créeraient deux sessions et les ventes se répartiraient entre les deux.
CREATE UNIQUE INDEX "caisse_sessions_une_seule_ouverte"
    ON "caisse_sessions"("pharmacy_id")
    WHERE "statut" = 'ouverte';

ALTER TABLE "sales"
    ADD COLUMN "caisse_session_id"   TEXT,
    ADD COLUMN "rattrapage_offline"  BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "sales"
    ADD CONSTRAINT "sales_caisse_session_id_fkey"
    FOREIGN KEY ("caisse_session_id") REFERENCES "caisse_sessions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "sales_caisse_session_id_idx" ON "sales"("caisse_session_id");

ALTER TABLE "pharmacies"
    ADD COLUMN "cloture_assistant_autorisee" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "cloture_pin_hash"            TEXT;
