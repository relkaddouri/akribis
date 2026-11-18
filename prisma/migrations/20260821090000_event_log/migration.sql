-- CreateTable
CREATE TABLE "event_log" (
    "id" TEXT NOT NULL,
    "acteur_id" TEXT NOT NULL,
    "acteur_email" TEXT NOT NULL,
    "acteur_role" TEXT NOT NULL,
    "type_action" TEXT NOT NULL,
    "entite" TEXT NOT NULL,
    "entite_id" TEXT NOT NULL,
    "pharmacy_id" TEXT,
    "avant" JSONB,
    "apres" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_log_type_action_created_at_idx" ON "event_log"("type_action", "created_at");
CREATE INDEX "event_log_entite_entite_id_idx" ON "event_log"("entite", "entite_id");
CREATE INDEX "event_log_acteur_id_created_at_idx" ON "event_log"("acteur_id", "created_at");

-- Inviolabilité : le journal est en AJOUT SEUL.
--
-- La contrainte vit en base et non dans le code applicatif, parce qu'un
-- journal d'audit qu'une faute de frappe dans une action serveur peut
-- réécrire ne prouve plus rien. Le déclencheur refuse toute modification
-- et toute suppression, quelle qu'en soit l'origine — y compris une
-- console SQL ouverte à la main.
--
-- Limite honnête : un rôle superutilisateur peut désactiver un
-- déclencheur (ALTER TABLE ... DISABLE TRIGGER). La contrainte protège de
-- l'erreur et du code fautif, pas d'un administrateur base déterminé.
CREATE OR REPLACE FUNCTION "event_log_ajout_seul"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'event_log est un journal en ajout seul : % refuse.', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "event_log_ni_update_ni_delete"
  BEFORE UPDATE OR DELETE ON "event_log"
  FOR EACH ROW EXECUTE FUNCTION "event_log_ajout_seul"();
