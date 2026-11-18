import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Une vente n'appartient jamais à deux bordereaux actifs.
 *
 * C'est l'invariant qui protège l'argent : réclamer deux fois la même
 * vente, c'est au mieux un rejet, au pire un trop-perçu à rendre — et dans
 * les deux cas une comptabilité fausse.
 *
 * Il ne peut pas reposer sur le statut de la vente seul. `EN_ATTENTE_BORDEREAU`
 * filtre les candidates, mais deux créations concurrentes lisent ce statut
 * au même instant, passent toutes les deux, et écrivent toutes les deux.
 * Seule la base peut les départager, d'où l'index unique PARTIEL posé par
 * la migration — partiel parce qu'une ligne rejetée doit libérer la vente.
 *
 * Vérifié en lisant la migration : la contrainte vit en base, et un test
 * qui la simulerait en mémoire ne dirait rien de ce qui s'y trouve
 * réellement. Le comportement de l'index a été éprouvé contre Postgres
 * dans une transaction annulée — voir le rapport de session.
 */

const migration = readFileSync(
  resolve(__dirname, "../..", "prisma/migrations/20260821230000_bordereaux/migration.sql"),
  "utf8",
);

describe("la contrainte d'unicité vit en base", () => {
  it("un index unique porte sur la vente", () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "bordereau_ventes_sale_actif_key"[\s\S]*?ON "bordereau_ventes"\("sale_id"\)/,
    );
  });

  it("il est partiel, et n'exclut que les lignes rejetées", () => {
    // Un index total interdirait de réinclure une vente rejetée, donc de
    // récupérer l'argent après correction. Un index absent laisserait
    // passer la double réclamation.
    const index = /CREATE UNIQUE INDEX "bordereau_ventes_sale_actif_key"[\s\S]*?;/.exec(migration);
    expect(index, "index introuvable").toBeTruthy();
    expect(index![0]).toMatch(/WHERE "statut" <> 'rejetee'/);
  });
});

describe("la façade s'appuie sur la base plutôt que sur sa propre lecture", () => {
  const src = readFileSync(resolve(__dirname, "../..", "lib/server/bordereaux.ts"), "utf8");

  it("relit les ventes éligibles à l'intérieur de la transaction", () => {
    // La liste affichée à l'écran date de quelques secondes : une vente a
    // pu entrer dans un autre bordereau entre-temps.
    const transaction = /prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?\n    \}\);/.exec(src);
    expect(transaction, "transaction de création introuvable").toBeTruthy();
    expect(transaction![0]).toMatch(/tx\.sale\.findMany/);
    expect(transaction![0]).toMatch(/statutCreance: "EN_ATTENTE_BORDEREAU"/);
  });

  it("traduit la violation d'index en message utilisable", () => {
    // Sans ce traitement, la course entre deux créations remonterait au
    // pharmacien sous forme de trace Prisma.
    expect(src).toMatch(/code\?: string[\s\S]*?"P2002"/);
    expect(src).toMatch(/déjà été incluse|vient d'être incluse/);
  });

  it("ne passe les ventes en bordereau que dans la même transaction", () => {
    // Un statut basculé hors transaction laisserait des ventes marquées
    // « dans un bordereau » qui n'existe pas, invisibles pour toujours.
    const transaction = /prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?\n    \}\);/.exec(src);
    expect(transaction![0]).toMatch(/tx\.sale\.updateMany[\s\S]*?DANS_BORDEREAU/);
  });

  it("un rejet remet la vente en attente", () => {
    // Sans cela, une vente rejetée resterait bloquée en « dans un
    // bordereau » et ne serait jamais réclamée à nouveau.
    const rejet = /export async function rejeterLigne[\s\S]*?\n\}/.exec(src);
    expect(rejet, "rejeterLigne introuvable").toBeTruthy();
    expect(rejet![0]).toMatch(/statutCreance: "EN_ATTENTE_BORDEREAU"/);
    expect(rejet![0]).toMatch(/statut: "REJETEE"/);
  });
});

/**
 * La clôture d'un bordereau, et ce qu'elle implique pour ses lignes.
 *
 * L'écran se contredisait : « Clôturé » en tête, « En attente » sur chaque
 * ligne. Un organisme qui verse exactement ce qu'on lui réclame a accepté
 * chaque ligne non rejetée — c'est la définition même de la concordance.
 */
describe("la clôture accepte les lignes", () => {
  const src = readFileSync(resolve(__dirname, "../..", "lib/server/bordereaux.ts"), "utf8");

  it("passe les lignes non rejetées à acceptée", () => {
    const paiement = /export async function enregistrerPaiement[\s\S]*?\n\}/.exec(src);
    expect(paiement, "enregistrerPaiement introuvable").toBeTruthy();
    expect(paiement![0]).toMatch(/bordereauVente\.updateMany[\s\S]*?statut: "ACCEPTEE"/);
  });

  it("n'accepte jamais une ligne rejetée", () => {
    // Un rejet reste un rejet : le repasser en accepté ferait réclamer une
    // seconde fois une vente déjà remise en circulation.
    const paiement = /export async function enregistrerPaiement[\s\S]*?\n\}/.exec(src);
    expect(paiement![0]).toMatch(/statut: \{ not: "REJETEE" \}/);
  });

  it("ne touche aux lignes que si les montants concordent", () => {
    // Un versement partiel n'est pas une acceptation : il reste à savoir
    // quelle ligne l'organisme a refusée.
    const paiement = /export async function enregistrerPaiement[\s\S]*?\n\}/.exec(src);
    const bloc = /if \(rapprochement\.concordant[\s\S]*?\n    \}/.exec(paiement![0]);
    expect(bloc, "bloc conditionnel introuvable").toBeTruthy();
    expect(bloc![0]).toMatch(/ACCEPTEE/);
  });
});

describe("un rejet après clôture rouvre le bordereau", () => {
  const src = readFileSync(resolve(__dirname, "../..", "lib/server/bordereaux.ts"), "utf8");

  it("repasse le bordereau en traitement", () => {
    // Le montant attendu baisse, le reçu ne bouge pas : laisser « clôturé »
    // masquerait un écart que l'officine doit réclamer.
    const rejet = /export async function rejeterLigne[\s\S]*?\n\}/.exec(src);
    expect(rejet![0]).toMatch(/bordereau\.updateMany[\s\S]*?statut: "EN_TRAITEMENT"/);
  });

  it("ne rouvre que ce qui était clôturé", () => {
    // Un bordereau en brouillon ne doit pas être promu « en traitement »
    // par un simple rejet.
    const rejet = /export async function rejeterLigne[\s\S]*?\n\}/.exec(src);
    expect(rejet![0]).toMatch(/where: \{ id: ligne\.bordereauId, statut: "CLOTURE" \}/);
  });

  it("fait les quatre écritures dans la même transaction", () => {
    // Ligne rejetée sans vente remise en circulation, ou bordereau resté
    // clôturé : chaque moitié appliquée seule laisse un état incohérent.
    const rejet = /export async function rejeterLigne[\s\S]*?\n\}/.exec(src);
    const transaction = /prisma\.\$transaction\(\[[\s\S]*?\n  \]\);/.exec(rejet![0]);
    expect(transaction, "transaction introuvable").toBeTruthy();
    expect(transaction![0]).toMatch(/bordereauVente\.update/);
    expect(transaction![0]).toMatch(/sale\.update/);
    expect(transaction![0]).toMatch(/bordereau\.updateMany/);
  });
});

/**
 * L'annulation d'un rejet — le geste inverse, pour l'erreur de saisie.
 *
 * C'est le cas qui donne son sens à l'index unique partiel. Rejeter a
 * rendu la vente réclamable ailleurs ; si quelqu'un l'a fait entre-temps,
 * revenir en arrière ici la réclamerait deux fois. La base refuse, et
 * l'officine doit d'abord la retirer de l'autre bordereau.
 */
describe("annuler un rejet", () => {
  const src = readFileSync(resolve(__dirname, "../..", "lib/server/bordereaux.ts"), "utf8");
  const fonction = /export async function annulerRejet[\s\S]*?\n\}/.exec(src);

  it("existe", () => {
    expect(fonction, "annulerRejet introuvable").toBeTruthy();
  });

  it("remet la ligne en attente, jamais en accepté", () => {
    // L'organisme ne s'est pas prononcé : c'est l'officine qui s'était
    // trompée. Marquer « acceptée » inventerait une réponse.
    expect(fonction![0]).toMatch(/statut: "EN_ATTENTE", motifRejet: null/);
    expect(fonction![0]).not.toMatch(/statut: "ACCEPTEE"/);
  });

  it("ramène la vente dans ce bordereau", () => {
    expect(fonction![0]).toMatch(/statutCreance: "DANS_BORDEREAU"/);
  });

  it("refuse si la vente est repartie ailleurs, et l'explique", () => {
    // Sans ce traitement, la violation d'index remonterait au pharmacien
    // sous forme de trace Prisma, sur le geste le plus anodin qui soit.
    expect(fonction![0]).toMatch(/"P2002"/);
    expect(fonction![0]).toMatch(/incluse dans un autre bordereau/);
  });

  it("rouvre le bordereau clôturé au lieu de rejouer la clôture", () => {
    // Le montant attendu remonte : c'est un nouveau rapprochement, pas une
    // restauration de l'état d'avant. Un bordereau déjà clôturé qui voit une
    // ligne réapparaître redevient « en traitement », sinon l'écran continue
    // d'annoncer « réglé » sur un total qui vient de changer.
    expect(fonction![0]).toMatch(
      /where: \{ id: ligne\.bordereauId, statut: "CLOTURE" \}/,
    );
    expect(fonction![0]).toMatch(/data: \{ statut: "EN_TRAITEMENT" \}/);
    // Et jamais l'inverse : rien ici ne réécrit « clôturé ».
    expect(fonction![0]).not.toMatch(/data: \{ statut: "CLOTURE"/);
  });

  it("refuse d'annuler ce qui n'est pas rejeté", () => {
    expect(fonction![0]).toMatch(/statut !== "REJETEE"/);
  });
});
