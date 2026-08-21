import { describe, expect, it } from "vitest";
import { montantAttendu, rapprocher } from "@/lib/bordereaux/rapprochement";

/**
 * Le rapprochement d'un bordereau.
 *
 * Ce qu'il doit attraper : l'organisme qui verse autre chose que ce qu'on
 * lui a réclamé. Sans détection, l'officine clôturerait un bordereau en
 * croyant avoir été payée, et la différence disparaîtrait — personne ne
 * réclame ce dont personne ne sait qu'il manque.
 */

const ligne = (montantReclame: number, statut = "EN_ATTENTE") => ({ montantReclame, statut });

describe("le montant attendu", () => {
  it("somme les lignes du bordereau", () => {
    expect(montantAttendu([ligne(68.6), ligne(7.14), ligne(36.68)])).toBe(112.42);
  });

  it("retire les lignes rejetées", () => {
    // Une ligne rejetée n'est plus due : la garder gonflerait l'attendu et
    // ferait crier à l'écart sur un paiement pourtant juste.
    expect(montantAttendu([ligne(68.6), ligne(7.14, "REJETEE"), ligne(36.68)])).toBe(105.28);
  });

  it("compte les lignes acceptées comme les lignes en attente", () => {
    expect(montantAttendu([ligne(10, "ACCEPTEE"), ligne(5, "EN_ATTENTE")])).toBe(15);
  });

  it("vaut zéro quand tout est rejeté", () => {
    expect(montantAttendu([ligne(10, "REJETEE"), ligne(5, "REJETEE")])).toBe(0);
  });
});

describe("la détection d'écart", () => {
  it("reconnaît un paiement exact", () => {
    const r = rapprocher([ligne(68.6), ligne(36.68)], 105.28);
    expect(r.concordant).toBe(true);
    expect(r.ecart).toBe(0);
    expect(r.montantAttendu).toBe(105.28);
  });

  it("signale un versement insuffisant, et de combien", () => {
    const r = rapprocher([ligne(68.6), ligne(36.68)], 100);
    expect(r.concordant).toBe(false);
    expect(r.ecart).toBe(-5.28);
  });

  it("signale aussi un trop-perçu", () => {
    // Un versement supérieur n'est pas une bonne nouvelle : c'est une
    // erreur de l'organisme, qui la reprendra sur un bordereau suivant.
    const r = rapprocher([ligne(100)], 120);
    expect(r.concordant).toBe(false);
    expect(r.ecart).toBe(20);
  });

  it("ne tolère pas un centime", () => {
    // Un écart de 0,01 n'est pas du bruit : il signale une ligne remboursée
    // à un autre taux, ou un rejet non signalé. Une tolérance ferait
    // disparaître précisément le signal qu'on cherche.
    const r = rapprocher([ligne(105.28)], 105.27);
    expect(r.concordant).toBe(false);
    expect(r.ecart).toBe(-0.01);
  });

  it("tient compte des rejets dans la comparaison", () => {
    // L'organisme a refusé une ligne et versé le reste : c'est concordant,
    // et le bordereau doit pouvoir se clôturer.
    const r = rapprocher([ligne(68.6), ligne(7.14, "REJETEE"), ligne(36.68)], 105.28);
    expect(r.concordant).toBe(true);
    expect(r.ecart).toBe(0);
  });

  it("n'invente pas de concordance sur un bordereau vide", () => {
    expect(rapprocher([], 0).concordant).toBe(true);
    expect(rapprocher([], 50).concordant).toBe(false);
  });

  it("ne dérive pas sur une addition de centimes", () => {
    // 0,1 + 0,2 en virgule flottante vaut 0,30000000000000004 : sans
    // arrondi, aucun paiement ne tomberait jamais juste.
    const r = rapprocher([ligne(0.1), ligne(0.2)], 0.3);
    expect(r.montantAttendu).toBe(0.3);
    expect(r.concordant).toBe(true);
  });
});
