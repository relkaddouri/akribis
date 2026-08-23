-- Immuabilité des ventes d'une session clôturée.
--
-- ## Ce que la contrainte gèle, et ce qu'elle laisse passer
--
-- La demande disait « toute vente rattachée ne peut plus être modifiée »,
-- en supposant qu'un retour ne touche jamais la vente d'origine. C'est
-- inexact dans cette application : un retour écrit `return_status`, la
-- facturation écrit `invoice_id`, et le rapprochement d'un bordereau écrit
-- `statut_creance`. Une contrainte posée sur la ligne entière casserait
-- ces trois flux — dont le retour, que la demande veut justement préserver.
--
-- Ce qui est gelé, c'est donc la **substance financière** : exactement ce
-- qu'un Journal Z additionne. Si l'une de ces colonnes changeait après la
-- clôture, le Z archivé cesserait de correspondre aux ventes qu'il résume,
-- et c'est le seul dommage que cette contrainte doit empêcher.
--
--   gelé    : total_amount, payment_method, montant_part_client,
--             montant_part_assurance, created_at, caisse_session_id,
--             client_id, insurer_id
--   ouvert  : return_status, invoice_id, statut_creance
--
-- La suppression, elle, est refusée sans exception : une vente retirée
-- d'un Z clôturé le fausse quelles que soient ses colonnes.
--
-- Limite honnête, la même que pour event_log : un superutilisateur peut
-- désactiver un déclencheur. La contrainte protège de l'erreur et du code
-- fautif, pas d'un administrateur base déterminé.

CREATE OR REPLACE FUNCTION "vente_session_cloturee_figee"() RETURNS trigger AS $$
DECLARE
  session_cloturee BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT statut = 'cloturee' INTO session_cloturee
      FROM "caisse_sessions" WHERE id = OLD."caisse_session_id";
    IF COALESCE(session_cloturee, FALSE) THEN
      RAISE EXCEPTION
        'Vente rattachée à une session de caisse clôturée : suppression refusée.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  SELECT statut = 'cloturee' INTO session_cloturee
    FROM "caisse_sessions" WHERE id = OLD."caisse_session_id";

  IF COALESCE(session_cloturee, FALSE) AND (
       NEW."total_amount"           IS DISTINCT FROM OLD."total_amount"
    OR NEW."payment_method"         IS DISTINCT FROM OLD."payment_method"
    OR NEW."montant_part_client"    IS DISTINCT FROM OLD."montant_part_client"
    OR NEW."montant_part_assurance" IS DISTINCT FROM OLD."montant_part_assurance"
    OR NEW."created_at"             IS DISTINCT FROM OLD."created_at"
    OR NEW."caisse_session_id"      IS DISTINCT FROM OLD."caisse_session_id"
    OR NEW."client_id"              IS DISTINCT FROM OLD."client_id"
    OR NEW."insurer_id"             IS DISTINCT FROM OLD."insurer_id"
  ) THEN
    RAISE EXCEPTION
      'Vente rattachée à une session de caisse clôturée : montants et rattachement figés.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_session_cloturee_figee"
  BEFORE UPDATE OR DELETE ON "sales"
  FOR EACH ROW EXECUTE FUNCTION "vente_session_cloturee_figee"();

-- Symétrique côté lignes : les quantités et prix d'une vente close sont
-- figés, mais `returned_quantity` doit continuer de bouger — c'est par
-- elle qu'un retour s'enregistre.
CREATE OR REPLACE FUNCTION "ligne_vente_session_cloturee_figee"() RETURNS trigger AS $$
DECLARE
  session_cloturee BOOLEAN;
BEGIN
  SELECT s.statut = 'cloturee' INTO session_cloturee
    FROM "sales" v
    JOIN "caisse_sessions" s ON s.id = v."caisse_session_id"
   WHERE v.id = COALESCE(OLD."sale_id", NEW."sale_id");

  IF NOT COALESCE(session_cloturee, FALSE) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Ligne de vente rattachée à une session clôturée : suppression refusée.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."quantity"   IS DISTINCT FROM OLD."quantity"
  OR NEW."unit_price" IS DISTINCT FROM OLD."unit_price"
  OR NEW."product_id" IS DISTINCT FROM OLD."product_id" THEN
    RAISE EXCEPTION
      'Ligne de vente rattachée à une session clôturée : quantité et prix figés.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sale_items_session_cloturee_figee"
  BEFORE UPDATE OR DELETE ON "sale_items"
  FOR EACH ROW EXECUTE FUNCTION "ligne_vente_session_cloturee_figee"();
